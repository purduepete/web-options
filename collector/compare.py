"""Persist Azure evidence separately; never use it to populate a local quote."""

from datetime import UTC, datetime
from collections import Counter
from decimal import Decimal, ROUND_HALF_UP
import json

from psycopg.types.json import Jsonb

from .model import PACIFIC, now
from .source import comparator_rows

FIELDS = {
    "bid": "bid_per_share", "ask": "ask_per_share", "mark": "mark_per_share",
    "mid": "mid_per_share", "last_price": "last_per_share",
    "underlying_price": "underlying_price", "delta": "delta",
    "implied_volatility": "implied_volatility_fraction",
}


def utc(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def assess(run: dict, local: dict, source: dict, observed: datetime, dataset="tracked_1315") -> dict:
    captured = utc(source.get("captured_at_utc"))
    receipt = local.get("price_received_at")
    reasons = []
    if source.get("missing"):
        reasons.append("azure_missing")
    if dataset == "portfolio_halfhour":
        reasons.append("source_run_write_timestamp_unavailable_daily_row_overwritten")
    elif run["capture_kind"] != "closing_1315":
        reasons.append("purpose_not_overlapping_tracked_1315")
    if dataset == "tracked_1315" and source.get("market_session") != "regular_close":
        reasons.append("source_purpose_unverified")
    if captured is None or not run["scheduled_at"] <= captured <= run["deadline"]:
        reasons.append("source_run_unverified")
    if receipt is None or abs((observed - receipt).total_seconds()) > 60:
        reasons.append("receipt_distance_over_60s")
    # Azure's row has a capture date, but no field-specific broker business dates.
    reasons.append("field_session_dates_unverified")
    fields = {}
    for source_name, local_name in FIELDS.items():
        if dataset == "portfolio_halfhour" and source_name in ("underlying_price", "implied_volatility"):
            fields[source_name] = "not_in_source_contract"
            continue
        a, b = source.get(source_name), local.get(local_name)
        if source.get("missing"):
            fields[source_name] = "source_row_unavailable"
        elif a is None and b is None:
            fields[source_name] = "both_missing"
        elif a is None:
            fields[source_name] = "azure_missing"
        elif b is None:
            fields[source_name] = "local_coverage_failure"
        else:
            a, b = Decimal(str(a)), Decimal(str(b))
            tolerance = Decimal("0") if source_name in ("delta", "implied_volatility") else Decimal(".01")
            scale = Decimal(".0001") if dataset == "portfolio_halfhour" and source_name == "delta" else Decimal(".000001")
            fields[source_name] = (
                "numeric_match" if abs(a.quantize(scale, rounding=ROUND_HALF_UP) -
                                       b.quantize(scale, rounding=ROUND_HALF_UP)) <= tolerance else "numeric_mismatch"
            )
    return {"status": "inconclusive" if reasons else "matched", "reasons": reasons, "fields": fields}


def compare(config, repo, run_id: int) -> dict:
    run = repo.execute("SELECT * FROM public.option_collection_run WHERE id=%s", (run_id,)).fetchone()
    if run is None:
        raise ValueError("unknown local run")
    tracked_owners = repo.execute(
        """SELECT DISTINCT owner_payload->>'original_contract_key' AS original_contract_key
           FROM public.option_capture_owner
           WHERE run_id=%s AND source_kind IN ('signal','vader_contract')""", (run_id,),
    ).fetchall()
    portfolio_owners = repo.execute(
        """SELECT DISTINCT owner_payload->>'original_contract_key' AS original_contract_key
           FROM public.option_capture_owner WHERE run_id=%s AND source_kind='portfolio'""",
        (run_id,),
    ).fetchall()
    existing = repo.execute(
        "SELECT * FROM public.azure_option_observation WHERE run_id=%s AND dataset='tracked_1315'",
        (run_id,),
    ).fetchall()
    if not existing and run["capture_kind"] == "closing_1315":
        source = {str(row["contract_key"]).strip(): row
                  for row in comparator_rows(config.azure, run["session_date"])}
        received = now()
        with repo.connection.transaction():
            for owner in tracked_owners:
                key = owner["original_contract_key"]
                payload = source.get(key, {"missing": True})
                repo.execute(
                    """INSERT INTO public.azure_option_observation
                       (run_id,dataset,source_key,observed_at,source_payload)
                       VALUES (%s,'tracked_1315',%s,%s,%s) ON CONFLICT DO NOTHING""",
                    (run_id, key, received, Jsonb(json.loads(json.dumps(payload, default=str)))),
                )
        existing = repo.execute(
            "SELECT * FROM public.azure_option_observation WHERE run_id=%s AND dataset='tracked_1315'",
            (run_id,),
        ).fetchall()
    results = []
    for observation in existing:
        local = repo.execute(
            """SELECT q.* FROM public.broker_option_quote q
               JOIN public.option_capture_owner o USING (run_id,contract_key)
               WHERE q.run_id=%s AND o.owner_payload->>'original_contract_key'=%s LIMIT 1""",
            (run_id, observation["source_key"]),
        ).fetchone()
        if local is not None:
            results.append({"contract": observation["source_key"],
                            **assess(run, local, observation["source_payload"], observation["observed_at"])})
    portfolio_results = []
    local_time = run["scheduled_at"].astimezone(PACIFIC)
    overlap = run["capture_kind"] == "open_session" and (7, 30) <= (local_time.hour, local_time.minute) <= (12, 30)
    if overlap:
        evidence = repo.execute(
            "SELECT * FROM public.azure_option_observation WHERE run_id=%s AND dataset='portfolio_halfhour'",
            (run_id,),
        ).fetchall()
        if not evidence:
            source = {f"portfolio:{row['transaction_id']}": row
                      for row in comparator_rows(config.azure, run["session_date"], portfolio=True)}
            received = now()
            with repo.connection.transaction():
                for owner in portfolio_owners:
                    key = owner["original_contract_key"]
                    repo.execute(
                        """INSERT INTO public.azure_option_observation
                           (run_id,dataset,source_key,observed_at,source_payload)
                           VALUES (%s,'portfolio_halfhour',%s,%s,%s) ON CONFLICT DO NOTHING""",
                        (run_id, key, received, Jsonb(json.loads(json.dumps(source.get(key, {"missing": True}),
                                                                          default=str)))),
                    )
            evidence = repo.execute(
                "SELECT * FROM public.azure_option_observation WHERE run_id=%s AND dataset='portfolio_halfhour'",
                (run_id,),
            ).fetchall()
        for observation in evidence:
            local = repo.execute(
                """SELECT q.* FROM public.broker_option_quote q
                   JOIN public.option_capture_owner o USING (run_id,contract_key)
                   WHERE q.run_id=%s AND o.owner_payload->>'original_contract_key'=%s LIMIT 1""",
                (run_id, observation["source_key"]),
            ).fetchone()
            if local is not None:
                portfolio_results.append({"owner": observation["source_key"],
                                          **assess(run, local, observation["source_payload"],
                                                   observation["observed_at"], "portfolio_halfhour")})
    return {
        "run_id": run_id, "tracked_1315": results,
        "field_counts": {
            field: dict(Counter(result["fields"][field] for result in results)) for field in FIELDS
        },
        "portfolio_halfhour": portfolio_results if overlap else "not_applicable",
        "portfolio_field_counts": {
            field: dict(Counter(result["fields"][field] for result in portfolio_results)) for field in FIELDS
        },
        "date_gate": "unverified: Azure closing rows lack field-specific broker session dates",
        "numeric_matches_are_not_parity": True,
    }
