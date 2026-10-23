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
                if row["source_kind"] != "signal":
                    continue
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
            self.execute("UPDATE public.option_owner SET source_current=false")
            for row in rows:
                contract = row["contract"]
                payload = {key: value for key, value in row.items() if key != "contract"}
                serialized = Jsonb(json.loads(json.dumps(payload, default=str)))
                self.execute(
                    """
                    INSERT INTO public.broker_contract(contract_key,symbol,expiration,strike)
                    VALUES (%s,%s,%s,%s) ON CONFLICT (contract_key) DO UPDATE
                    SET synced_at=CURRENT_TIMESTAMP
                    """,
                    (contract.broker_occ, contract.broker_occ[:6].strip(), contract.expiration, contract.strike),
                )
                self.execute(
                    """
                    INSERT INTO public.option_owner
                    (source_kind,source_id,contract_key,original_contract_key,authenticated_user_id,
                     account_id,is_paper,report_date,source_payload)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (source_kind,source_id) DO UPDATE SET
                      contract_key=EXCLUDED.contract_key,original_contract_key=EXCLUDED.original_contract_key,
                      authenticated_user_id=EXCLUDED.authenticated_user_id,account_id=EXCLUDED.account_id,
                      is_paper=EXCLUDED.is_paper,report_date=EXCLUDED.report_date,
                      source_payload=EXCLUDED.source_payload,source_current=true,synced_at=CURRENT_TIMESTAMP
                    """,
                    (row["source_kind"], row["source_id"], contract.broker_occ, contract.key,
                     row.get("authenticated_user_id"), row.get("account_id"),
                     bool(row["is_paper"]) if row.get("is_paper") is not None else None,
                     row.get("report_date"), serialized),
                )
                if row["source_kind"] != "signal":
                    continue
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
                    (source_id,contract_key,report_date,tier,is_top_pick,advertised_premium_per_contract,
                     advertised_delta,entry_mark_per_share,entry_delta,entry_iv_fraction,source_payload)
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                    ON CONFLICT (source_id) DO UPDATE SET
                        contract_key=EXCLUDED.contract_key,report_date=EXCLUDED.report_date,
                        tier=EXCLUDED.tier,is_top_pick=EXCLUDED.is_top_pick,
                        advertised_premium_per_contract=EXCLUDED.advertised_premium_per_contract,
                        advertised_delta=EXCLUDED.advertised_delta,entry_mark_per_share=EXCLUDED.entry_mark_per_share,
                        entry_delta=EXCLUDED.entry_delta,entry_iv_fraction=EXCLUDED.entry_iv_fraction,
                        source_payload=EXCLUDED.source_payload,source_current=true,synced_at=CURRENT_TIMESTAMP
                """,
                    (
                        row["source_id"],
                        contract.key,
                        row["report_date"],
                        row["tier"],
                        bool(row.get("is_top_pick")),
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
            SELECT c.contract_key,c.symbol,c.expiration,c.strike FROM public.broker_contract c
            WHERE c.expiration >= %s AND EXISTS (
                SELECT 1 FROM public.option_owner o
                WHERE o.contract_key=c.contract_key AND o.source_current
            ) ORDER BY c.contract_key
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
                    SET status=CASE WHEN option_collection_run.status='pending' THEN 'missed'
                                    WHEN option_collection_run.status='running' THEN 'partial'
                                    ELSE option_collection_run.status END,
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
                    INSERT INTO public.broker_option_quote (run_id,contract_key) VALUES (%s,%s)
                    ON CONFLICT DO NOTHING
                """,
                    (run_id, contract.key),
                )
            self.execute(
                """
                INSERT INTO public.option_capture_owner(run_id,contract_key,source_kind,source_id,owner_payload)
                SELECT q.run_id,o.contract_key,o.source_kind,o.source_id,
                       to_jsonb(o) - 'synced_at'
                FROM public.option_owner o JOIN public.broker_option_quote q
                  ON q.contract_key=o.contract_key AND q.run_id=%s
                WHERE o.source_current ON CONFLICT DO NOTHING
                """,
                (run_id,),
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
            for row in self.execute("SELECT * FROM public.broker_option_quote WHERE run_id=%s", (run_id,)).fetchall()
        }

    def save(self, run_id: int, key: str, component: str, values: dict, deadline: datetime) -> None:
        received = values["received_at"]
        if received > deadline:
            self.execute(
                """
                INSERT INTO public.broker_quote_diagnostic (run_id,contract_key,component,received_at,reason)
                VALUES (%s,%s,%s,%s,'late')
            """,
                (run_id, key, component, received),
            )
            return
        if component == "price":
            self.execute(
                """
                UPDATE public.broker_option_quote SET
                  bid_per_share=%s,ask_per_share=%s,mark_per_share=%s,mid_per_share=%s,last_per_share=%s,
                  underlying_price=%s,provider_quote_time=%s,price_received_at=%s,
                  price_flags=%s,price_status=%s,price_error=%s,
                  provider_summary_date=%s,provider_prev_close_date=%s,provider_last_trade_time=%s
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
                    values.get("summary_date"),
                    values.get("prev_close_date"),
                    values.get("last_trade_time"),
                    run_id,
                    key,
                ),
            )
        elif component in ("delta", "iv"):
            column = "delta" if component == "delta" else "implied_volatility_fraction"
            # Component and column names are restricted constants, never provider input.
            query = sql.SQL("""
                UPDATE public.broker_option_quote SET {value}=%s,{event}=%s,
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

    def price_unavailable(self, run_id: int, key: str, received: datetime) -> None:
        self.execute(
            """
            UPDATE public.broker_option_quote SET price_error='provider_no_quote'
            WHERE run_id=%s AND contract_key=%s AND price_status <> 'ok'
            """, (run_id, key),
        )
        self.execute(
            """
            INSERT INTO public.broker_quote_diagnostic(run_id,contract_key,component,received_at,reason)
            VALUES (%s,%s,'price',%s,'successful_response_without_contract')
            """, (run_id, key, received),
        )

    def component_error(self, run_id: int, component: str, reason: str) -> None:
        if component not in ("price", "delta", "iv"):
            raise ValueError("unknown quote component")
        self.execute(
            sql.SQL("""
            UPDATE public.broker_option_quote SET {error}=%s WHERE run_id=%s AND {status} <> 'ok'
        """).format(error=sql.Identifier(f"{component}_error"), status=sql.Identifier(f"{component}_status")),
            (reason, run_id),
        )

    def share_capture(self, source: int, target: int, deadline: datetime) -> None:
        rows = self.execute(
            "SELECT * FROM public.broker_option_quote WHERE run_id=%s", (source,)
        ).fetchall()
        for row in rows:
            if row["price_status"] == "ok":
                self.save(target, row["contract_key"], "price", {
                    **{name: row[f"{name}_per_share"] for name in ("bid", "ask", "mark", "mid", "last")},
                    "underlying": row["underlying_price"], "event_time": row["provider_quote_time"],
                    "received_at": row["price_received_at"], "flags": row["price_flags"], "status": "ok",
                    "summary_date": row.get("provider_summary_date"),
                    "prev_close_date": row.get("provider_prev_close_date"),
                    "last_trade_time": row.get("provider_last_trade_time"),
                }, deadline)
            for component, column in (("delta", "delta"), ("iv", "implied_volatility_fraction")):
                if row[f"{component}_status"] == "ok":
                    self.save(target, row["contract_key"], component, {
                        "value": row[column], "event_time": row[f"{component}_event_time"],
                        "received_at": row[f"{component}_received_at"], "flags": row[f"{component}_flags"],
                    }, deadline)

    def finish(self, run_id: int, at: datetime, failed: bool = False) -> dict:
        counts = self.execute(
            """
            SELECT count(*) AS expected,
                   count(*) FILTER (WHERE price_status='ok') AS price,
                   count(*) FILTER (WHERE delta_status='ok') AS delta,
                   count(*) FILTER (WHERE iv_status='ok') AS iv
            FROM public.broker_option_quote WHERE run_id=%s
        """,
            (run_id,),
        ).fetchone()
        status = (
            "failed"
            if failed or self.execute(
                "SELECT discovery_status FROM public.option_collection_run WHERE id=%s", (run_id,)
            ).fetchone()["discovery_status"] != "ok"
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
