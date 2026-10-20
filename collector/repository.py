from __future__ import annotations

from datetime import date, datetime
import json

import psycopg
from psycopg.rows import dict_row
from psycopg import sql
from psycopg.types.json import Jsonb

from .model import Contract, Slot

LOCK_KEY = 57236018797


class Repository:
    def __init__(self, dsn: str):
        self.connection = psycopg.connect(
            dsn,
            autocommit=True,
            row_factory=dict_row,
            connect_timeout=10,
            options="-c timezone=UTC -c statement_timeout=20000",
        )

    def close(self) -> None:
        self.connection.close()

    def execute(self, sql: str, args: tuple = ()):
        return self.connection.execute(sql, args)

    def lock(self) -> bool:
        return self.execute("SELECT pg_try_advisory_lock(%s) AS locked", (LOCK_KEY,)).fetchone()["locked"]

    def heartbeat(self, error: str | None = None, *, clear: bool = False) -> None:
        self.execute(
            """
            INSERT INTO public.collector_health (id, heartbeat_at, last_error)
            VALUES (1, CURRENT_TIMESTAMP, %s)
            ON CONFLICT (id) DO UPDATE SET heartbeat_at=EXCLUDED.heartbeat_at,
                last_error=CASE WHEN %s THEN NULL
                               ELSE COALESCE(EXCLUDED.last_error,collector_health.last_error) END
        """,
            (error, clear),
        )

    def sync(self, rows: list[dict], day: date) -> None:
        with self.connection.transaction():
            # Preserve previously discovered contracts even after source corrections.
            self.execute(
                """
                UPDATE public.vader_signal SET source_current=false
                WHERE contract_key IN (SELECT contract_key FROM public.vader_contract WHERE expiration >= %s)
            """,
                (day,),
            )
            for row in rows:
                contract = row["contract"]
                self.execute(
                    """
                    INSERT INTO public.vader_contract
                        (contract_key,symbol,expiration,strike,occ_symbol,first_seen)
                    VALUES (%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (contract_key) DO UPDATE
                    SET first_seen=LEAST(vader_contract.first_seen,EXCLUDED.first_seen),synced_at=CURRENT_TIMESTAMP
                """,
                    (
                        contract.key,
                        contract.symbol,
                        contract.expiration,
                        contract.strike,
                        contract.occ,
                        row["report_date"],
                    ),
                )
                payload = {key: value for key, value in row.items() if key != "contract"}
                serialized = Jsonb(json.loads(json.dumps(payload, default=str)))
                self.execute(
                    """
                    INSERT INTO public.vader_signal_revision (source_id,prior_payload)
                    SELECT source_id,source_payload FROM public.vader_signal
                    WHERE source_id=%s AND source_payload <> %s
                """,
                    (row["source_id"], serialized),
                )
                self.execute(
                    """
                    INSERT INTO public.vader_signal
                    (source_id,contract_key,report_date,tier,advertised_premium_per_contract,
                     advertised_delta,entry_mark_per_share,entry_delta,entry_iv_fraction,source_payload)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (source_id) DO UPDATE SET
                        tier=EXCLUDED.tier,advertised_premium_per_contract=EXCLUDED.advertised_premium_per_contract,
                        advertised_delta=EXCLUDED.advertised_delta,entry_mark_per_share=EXCLUDED.entry_mark_per_share,
                        entry_delta=EXCLUDED.entry_delta,entry_iv_fraction=EXCLUDED.entry_iv_fraction,
                        source_payload=EXCLUDED.source_payload,source_current=true,synced_at=CURRENT_TIMESTAMP
                """,
                    (
                        row["source_id"],
                        contract.key,
                        row["report_date"],
                        row["tier"],
                        row["premium"],
                        row["advertised_delta"],
                        row["entry_mark_per_share"],
                        row["entry_delta"],
                        row["entry_iv"],
                        serialized,
                    ),
                )

    def contracts(self, day: date) -> list[Contract]:
        rows = self.execute(
            """
            SELECT contract_key,symbol,expiration,strike FROM public.vader_contract
            WHERE expiration >= %s ORDER BY occ_symbol
        """,
            (day,),
        ).fetchall()
        return [Contract(row["contract_key"], row["symbol"], row["expiration"], row["strike"]) for row in rows]

    def reconcile(self, scheduled: list[Slot], at: datetime) -> None:
        for slot in scheduled:
            if slot.deadline < at:
                self.execute(
                    """
                    INSERT INTO public.option_collection_run
                        (session_date,capture_kind,scheduled_at,deadline,status,finished_at)
                    VALUES (%s,%s,%s,%s,'missed',%s)
                    ON CONFLICT (session_date,capture_kind,scheduled_at) DO UPDATE
                    SET status=CASE WHEN option_collection_run.status IN ('running','pending')
                                    THEN 'partial' ELSE option_collection_run.status END,
                        finished_at=COALESCE(option_collection_run.finished_at,EXCLUDED.finished_at)
                """,
                    (slot.session, slot.kind, slot.instant, slot.deadline, at),
                )

    def runs(self, day: date) -> list[dict]:
        return self.execute(
            "SELECT * FROM public.option_collection_run WHERE session_date=%s ORDER BY scheduled_at", (day,)
        ).fetchall()

    def run(self, slot: Slot, at: datetime) -> int:
        return self.execute(
            """
            INSERT INTO public.option_collection_run
                (session_date,capture_kind,scheduled_at,deadline,started_at,status)
            VALUES (%s,%s,%s,%s,%s,'running')
            ON CONFLICT (session_date,capture_kind,scheduled_at) DO UPDATE
            SET status='running',started_at=COALESCE(option_collection_run.started_at,EXCLUDED.started_at)
            RETURNING id
        """,
            (slot.session, slot.kind, slot.instant, slot.deadline, at),
        ).fetchone()["id"]

    def prepare(self, run_id: int, contracts: list[Contract], discovery: str, error: str | None) -> None:
        with self.connection.transaction():
            self.execute(
                """
                UPDATE public.option_collection_run r SET related_missed_slots=ARRAY(
                    SELECT prior.id FROM public.option_collection_run prior
                    WHERE prior.session_date=r.session_date AND prior.status='missed'
                      AND prior.scheduled_at < r.scheduled_at ORDER BY prior.scheduled_at
                ) WHERE r.id=%s AND r.capture_kind='recovery'
            """,
                (run_id,),
            )
            for contract in contracts:
                self.execute(
                    """
                    INSERT INTO public.option_quote (run_id,contract_key) VALUES (%s,%s)
                    ON CONFLICT DO NOTHING
                """,
                    (run_id, contract.key),
                )
            self.execute(
                """
                UPDATE public.option_collection_run SET expected_count=%s,discovery_status=%s,discovery_error=%s
                WHERE id=%s
            """,
                (len(contracts), discovery, error, run_id),
            )

    def missing(self, run_id: int) -> dict[str, set[str]]:
        return {
            row["contract_key"]: {
                component for component in ("price", "delta", "iv") if row[f"{component}_status"] != "ok"
            }
            for row in self.execute("SELECT * FROM public.option_quote WHERE run_id=%s", (run_id,)).fetchall()
        }

    def save(self, run_id: int, key: str, component: str, values: dict, deadline: datetime) -> None:
        received = values["received_at"]
        if received > deadline:
            self.execute(
                """
                INSERT INTO public.option_quote_diagnostic (run_id,contract_key,component,received_at,reason)
                VALUES (%s,%s,%s,%s,'late')
            """,
                (run_id, key, component, received),
            )
            return
        if component == "price":
            self.execute(
                """
                UPDATE public.option_quote SET
                  bid_per_share=%s,ask_per_share=%s,mark_per_share=%s,mid_per_share=%s,last_per_share=%s,
                  underlying_price=%s,provider_quote_time=%s,price_received_at=%s,
                  price_flags=%s,price_status=%s,price_error=%s
                WHERE run_id=%s AND contract_key=%s AND price_status <> 'ok'
            """,
                (
                    values["bid"],
                    values["ask"],
                    values["mark"],
                    values["mid"],
                    values["last"],
                    values.get("underlying"),
                    values["event_time"],
                    received,
                    values["flags"],
                    values["status"],
                    values.get("error"),
                    run_id,
                    key,
                ),
            )
        elif component in ("delta", "iv"):
            column = "delta" if component == "delta" else "implied_volatility_fraction"
            # Component and column names are restricted constants, never provider input.
            query = sql.SQL("""
                UPDATE public.option_quote SET {value}=%s,{event}=%s,
                  {received}=%s,{status}='ok',{flags}=%s,{error}=NULL
                WHERE run_id=%s AND contract_key=%s AND {value} IS NULL AND {status}='missing'
            """).format(
                value=sql.Identifier(column),
                event=sql.Identifier(f"{component}_event_time"),
                received=sql.Identifier(f"{component}_received_at"),
                status=sql.Identifier(f"{component}_status"),
                flags=sql.Identifier(f"{component}_flags"),
                error=sql.Identifier(f"{component}_error"),
            )
            self.execute(query, (values["value"], values["event_time"], received, values["flags"], run_id, key))
        else:
            raise ValueError("unknown quote component")

    def component_error(self, run_id: int, component: str, reason: str) -> None:
        if component not in ("price", "delta", "iv"):
            raise ValueError("unknown quote component")
        self.execute(
            sql.SQL("""
            UPDATE public.option_quote SET {error}=%s WHERE run_id=%s AND {status} <> 'ok'
        """).format(error=sql.Identifier(f"{component}_error"), status=sql.Identifier(f"{component}_status")),
            (reason, run_id),
        )

    def finish(self, run_id: int, at: datetime, failed: bool = False) -> dict:
        counts = self.execute(
            """
            SELECT count(*) AS expected,
                   count(*) FILTER (WHERE price_status='ok') AS price,
                   count(*) FILTER (WHERE delta_status='ok') AS delta,
                   count(*) FILTER (WHERE iv_status='ok') AS iv
            FROM public.option_quote WHERE run_id=%s
        """,
            (run_id,),
        ).fetchone()
        status = (
            "failed"
            if failed
            else (
                "no_work"
                if counts["expected"] == 0
                else "complete"
                if all(counts[key] == counts["expected"] for key in ("price", "delta", "iv"))
                else "partial"
            )
        )
        self.execute(
            """
            UPDATE public.option_collection_run
            SET finished_at=%s,status=%s,expected_count=%s,price_count=%s,delta_count=%s,iv_count=%s WHERE id=%s
        """,
            (at, status, counts["expected"], counts["price"], counts["delta"], counts["iv"], run_id),
        )
        return {"status": status, **counts}
