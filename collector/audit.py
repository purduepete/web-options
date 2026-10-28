"""Nightly value and coverage audit. Database access is SELECT-only."""

from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path
import sys

import psycopg
from psycopg.rows import dict_row

from .__main__ import notify
from .config import load_config
from .model import PACIFIC, now, session_bounds, slots
from .source import (
    COMPARATOR_QUERY,
    PORTFOLIO_COMPARATOR_QUERY,
    POSITION_QUERY,
    TRACKED_QUERY,
    connect,
    normalize,
)

RUN_QUERY = "SELECT * FROM public.option_collection_run WHERE session_date=%s ORDER BY scheduled_at"
QUOTE_QUERY = """
SELECT q.* FROM public.broker_option_quote q
JOIN public.option_collection_run r ON r.id=q.run_id WHERE r.session_date=%s
"""
PRICE_TOLERANCE = Decimal(".01")
DELTA_TOLERANCE = Decimal(".01")
IV_TOLERANCE = Decimal(".02")
# Differences past these limits are too large to be minutes of market drift and fail the audit.
GROSS_PRICE_FLOOR = Decimal(".50")
GROSS_PRICE_FRACTION = Decimal(".25")
GROSS_DELTA = Decimal(".15")
# A zero local price is wrong when the source shows more than this; a delta sign flip counts past this size.
ZERO_PRICE_SOURCE = Decimal(".05")
DELTA_SIGN_FLOOR = Decimal(".05")
# Below this share of expected rows compared, Azure gaps could be hiding collector defects.
MIN_COMPARED_FRACTION = Decimal(".5")
TIME_TOLERANCE = timedelta(minutes=20)
BROKER_UNQUOTED = "invalid_or_missing_bid_ask"
EXCUSED = ("complete", "no_work")


def unquoted(row: dict) -> bool:
    """The broker returned no usable bid/ask. Reported as an exception, not a collector failure."""
    return row.get("price_status") != "ok" and row.get("price_error") == BROKER_UNQUOTED


def timestamp(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = datetime.fromisoformat(value)
    return value.replace(tzinfo=UTC) if value.tzinfo is None else value.astimezone(UTC)


def section() -> dict:
    return {
        "status": "pass", "expected": 0, "compared": 0, "matched": 0,
        "missing_local": 0, "missing_azure": 0, "mismatches": 0, "examples": [], "failures": [],
    }


def failure_example(result: dict, category: str, example: dict) -> None:
    entry = {"reason": category, **example}
    result["failures"].append(entry)
    examples = result["examples"]
    if len(examples) < 20:
        examples.append(entry)
        return
    # Keep capped examples useful when informational rows have already filled the list.
    for index in range(len(examples) - 1, -1, -1):
        if not any(examples[index] is failure for failure in result["failures"]):
            examples[index] = entry
            return


def problem(result: dict, category: str, example: dict) -> None:
    result["status"] = "fail"
    result[category] = result.get(category, 0) + 1
    failure_example(result, category, example)


def note(result: dict, category: str, example: dict) -> None:
    """Azure-side gaps and value differences between non-simultaneous samples are reported, never failed."""
    result[category] = result.get(category, 0) + 1
    if len(result["examples"]) < 20:
        result["examples"].append({"reason": category, **example})


def compare_values(local: dict, source: dict, *, portfolio=False) -> list[dict]:
    fields = [
        ("mid", "mid_per_share", PRICE_TOLERANCE),
        ("mark", "mark_per_share", PRICE_TOLERANCE),
        ("delta", "delta", DELTA_TOLERANCE),
    ]
    if not portfolio:
        fields.append(("implied_volatility", "implied_volatility_fraction", IV_TOLERANCE))
    differences = []
    for source_name, local_name, tolerance in fields:
        a, b = local.get(local_name), source.get(source_name)
        if a is None and b is None:
            differences.append({"field": source_name, "reason": "both_missing"})
            continue
        if a is None or b is None:
            differences.append({"field": source_name, "local": a, "azure": b, "reason": "missing_value",
                                "gross": a is None})
            continue
        a, b = Decimal(str(a)), Decimal(str(b))
        if not a.is_finite() or not b.is_finite():
            differences.append({"field": source_name, "local": str(a), "azure": str(b), "gross": True})
        elif abs(a - b) > tolerance:
            differences.append({"field": source_name, "local": str(a), "azure": str(b),
                                "tolerance": str(tolerance), "gross": gross(source_name, a, b)})
    mid = next((difference for difference in differences if difference["field"] == "mid"), None)
    if mid and mid.get("gross") and "tolerance" in mid and marks_reconcile(local, source):
        local_mid = Decimal(str(local["mid_per_share"]))
        source_mid = Decimal(str(source["mid"]))
        if local_mid > 0 and source_mid > 0:
            mid["gross"] = False
            mid["reason"] = "marks_within_gross_price_threshold"
    return differences


def marks_reconcile(local: dict, source: dict) -> bool:
    local_mark, source_mark = local.get("mark_per_share"), source.get("mark")
    if local_mark is None or source_mark is None:
        return False
    local_mark, source_mark = Decimal(str(local_mark)), Decimal(str(source_mark))
    return (local_mark.is_finite() and source_mark.is_finite()
            and not gross("mark", local_mark, source_mark))


def gross(field: str, local: Decimal, source: Decimal) -> bool:
    if field in ("mid", "mark"):
        if local < 0 or (local == 0 and source > ZERO_PRICE_SOURCE):
            return True
        return abs(local - source) > max(GROSS_PRICE_FLOOR, max(abs(local), abs(source)) * GROSS_PRICE_FRACTION)
    if field == "delta":
        if abs(local) > 1:
            return True
        if min(abs(local), abs(source)) > DELTA_SIGN_FLOOR and (local > 0) != (source > 0):
            return True
        return abs(local - source) > GROSS_DELTA
    return False


def check_compared(result: dict) -> None:
    usable = result["expected"] - result.get("broker_unquoted", 0)
    if usable > 0 and result["compared"] < usable * MIN_COMPARED_FRACTION:
        problem(result, "low_comparison_coverage",
                {"compared": result["compared"], "expected": usable,
                 "minimum_fraction": str(MIN_COMPARED_FRACTION)})


def record(result: dict, identity: dict, differences: list[dict]) -> None:
    if any(difference.get("gross") for difference in differences):
        problem(result, "gross_mismatches", {**identity, "fields": differences})
    else:
        note(result, "mismatches", {**identity, "fields": differences})


def exception(result: dict, example: dict) -> None:
    result["broker_unquoted"] = result.get("broker_unquoted", 0) + 1
    examples = result.setdefault("broker_unquoted_examples", [])
    if len(examples) < 20:
        examples.append(example)


def acceptable(run: dict, quotes: list[dict]) -> bool:
    """Complete runs pass. A partial run passes only when every non-ok quote is broker-unquoted."""
    if run["status"] in EXCUSED:
        return True
    if run["status"] != "partial":
        return False
    rows = [row for row in quotes if row["run_id"] == run["id"]]
    failed = [row for row in rows
              if not all(row.get(f"{component}_status") == "ok" for component in ("price", "delta", "iv"))]
    return bool(failed) and all(unquoted(row) for row in failed)


def capture(runs: list[dict], kind: str) -> dict | None:
    candidates = [run for run in runs if run["capture_kind"] == kind]
    return max(candidates, key=lambda run: run["scheduled_at"], default=None)


def audit_day(day: date, discovery: list[dict], runs: list[dict], quotes: list[dict],
              vader_rows: list[dict], portfolio_rows: list[dict]) -> dict:
    sections = {name: section() for name in ("vader", "portfolio", "coverage")}
    report = {
        "date": day.isoformat(), "generated_at_local": now().astimezone(PACIFIC).isoformat(),
        "status": "pass", "sections": sections,
        "tolerances": {"price_per_share": str(PRICE_TOLERANCE), "signed_delta": str(DELTA_TOLERANCE),
                       "iv_fraction": str(IV_TOLERANCE), "vader_nearest_minutes": 20},
        "limitations": [
            "Portfolio values only: option_daily_price has no update timestamp or run identity.",
            "Current owners introduced after the Pacific audit date are excluded. Historical closures "
            "and ownership revisions are not reconstructed.",
            "VADER nearest samples within 20 minutes are value checks, not simultaneous quote parity.",
            "VADER's 13:15 sample is compared with the 13:10 settle capture only; Azure has no 13:00 sample.",
            "Portfolio is compared with the last open-session capture; Azure stops refreshing at 12:50.",
            "Broker no-quote contracts (no bid/ask) are reported under broker_unquoted and do not fail.",
            "VADER and portfolio mismatches and missing_azure are informational: the samples are minutes "
            "apart and Azure gaps are not collector failures.",
            "gross_mismatches fail: a price off by more than max($0.50, 25%) (a mid difference is "
            "informational when both mids are positive and both marks are finite and within that price threshold), "
            "a delta off by more than "
            "0.15, a non-finite value or a value missing locally.",
            "Also gross: a negative local price, a zero local price against an Azure price above $0.05, "
            "a local |delta| above 1, or a delta sign flip when both sides exceed 0.05.",
            "low_comparison_coverage fails when under half the expected rows could be compared with Azure.",
        ],
    }
    if session_bounds(day) is None:
        for result in sections.values():
            result["status"] = "not_run"
            result["note"] = "No exchange session; weekday-holiday settle capture is outside this audit."
        return report
    scoped = []
    for owner in discovery:
        kind = owner["source_kind"]
        if kind in ("vader_contract", "portfolio"):
            name, field = ("vader", "report_date") if kind == "vader_contract" else ("portfolio", "transaction_date")
            introduced = owner.get(field)
            if isinstance(introduced, datetime):
                introduced = timestamp(introduced).astimezone(PACIFIC).date()
            identity = {"source": owner["source_id"], "broker_contract": owner["contract"].broker_occ}
            if not isinstance(introduced, date):
                problem(sections[name], "invalid_source_date", {**identity, "field": field})
            elif introduced > day:
                note(sections[name], "introduced_after_session", {**identity, "source_date": introduced.isoformat()})
                continue
        scoped.append(owner)
    discovery = scoped
    local = {(row["run_id"], row["contract_key"]): row for row in quotes}
    source_by_contract = defaultdict(list)
    for row in vader_rows:
        source_by_contract[str(row["contract_key"]).strip()].append(row)
    tracked = {row["source_id"]: row for row in discovery if row["source_kind"] == "vader_contract"}
    vader = sections["vader"]
    vader["purposes"] = ["settle"]
    for kind in vader["purposes"]:
        run = capture(runs, kind)
        for original_key, owner in tracked.items():
            vader["expected"] += 1
            identity = {"contract": original_key, "broker_contract": owner["contract"].broker_occ, "purpose": kind}
            quote = local.get((run["id"], owner["contract"].broker_occ)) if run else None
            if quote is not None and unquoted(quote):
                exception(vader, identity)
                continue
            if quote is None:
                problem(vader, "missing_local", identity)
            reference = timestamp(quote.get("price_received_at")) if quote else None
            reference = reference or (run["scheduled_at"] if run else next(
                slot.instant for slot in slots(day) if slot.kind == kind
            ))
            candidates = [row for row in source_by_contract[original_key]
                          if timestamp(row.get("captured_at_utc")) is not None]
            nearest = min(candidates, key=lambda row: abs(timestamp(row["captured_at_utc"]) - reference),
                          default=None)
            if nearest is None or abs(timestamp(nearest["captured_at_utc"]) - reference) > TIME_TOLERANCE:
                note(vader, "missing_azure", identity)
                continue
            if quote is None:
                continue
            vader["compared"] += 1
            differences = compare_values(quote, nearest)
            if differences:
                record(vader, identity, differences)
            else:
                vader["matched"] += 1
    check_compared(vader)
    portfolio = sections["portfolio"]
    portfolio["note"] = ("Value agreement only; Azure daily row has no update timestamp. "
                         "Compared with the last open-session capture, after Azure's 12:50 refresh.")
    last_open = max((slot.instant for slot in slots(day) if slot.kind == "open_session"), default=None)
    run = next((r for r in runs if r["capture_kind"] == "open_session" and r["scheduled_at"] == last_open), None)
    portfolio["local_capture_at"] = last_open.astimezone(PACIFIC).isoformat() if last_open else None
    daily = defaultdict(list)
    for row in portfolio_rows:
        daily[str(row["transaction_id"]), bool(row["is_paper"])].append(row)
    for owner in discovery:
        if owner["source_kind"] != "portfolio":
            continue
        portfolio["expected"] += 1
        identity = {"transaction": owner["source_id"], "is_paper": bool(owner["is_paper"]),
                    "broker_contract": owner["contract"].broker_occ}
        quote = local.get((run["id"], owner["contract"].broker_occ)) if run else None
        sources = daily[owner["source_id"], bool(owner["is_paper"])]
        if quote is not None and unquoted(quote):
            exception(portfolio, identity)
            continue
        if quote is None:
            problem(portfolio, "missing_local", identity)
        if not sources:
            note(portfolio, "missing_azure", identity)
        elif len(sources) > 1:
            note(portfolio, "mismatches", {**identity, "detail": "ambiguous Azure daily rows"})
        elif quote is not None:
            portfolio["compared"] += 1
            differences = compare_values(quote, sources[0], portfolio=True)
            if differences:
                record(portfolio, identity, differences)
            else:
                portfolio["matched"] += 1
    check_compared(portfolio)
    coverage = sections["coverage"]
    expected = {owner["contract"].broker_occ for owner in discovery}
    coverage["distinct_contracts_expected"] = len(expected)
    coverage["slots"] = []
    for slot in slots(day):
        matches = [r for r in runs if r["capture_kind"] == slot.kind and r["scheduled_at"] == slot.instant]
        run = matches[0] if matches else None
        rows = [row for row in quotes if run and row["run_id"] == run["id"]]
        captured = {row["contract_key"] for row in rows
                    if all(row[f"{component}_status"] == "ok" for component in ("price", "delta", "iv"))}
        excused = {row["contract_key"] for row in rows if unquoted(row)} & expected
        for key in sorted(excused):
            exception(coverage, {"contract": key, "purpose": slot.kind, "at": slot.instant.isoformat()})
        # A successful discovery lists every contract the source had then; later additions are not misses.
        later = (expected - {row["contract_key"] for row in rows}
                 if run and run.get("discovery_status") == "ok" else set())
        if later:
            coverage["not_yet_discovered"] = coverage.get("not_yet_discovered", 0) + len(later)
        missing = expected - captured - excused - later
        coverage["expected"] += len(expected - later)
        coverage["matched"] += len(expected & captured)
        coverage["slots"].append({
            "kind": slot.kind, "at_local": slot.instant.astimezone(PACIFIC).isoformat(),
            "expected": len(expected - later), "captured": len(expected & captured),
            "run_status": run["status"] if run else "missing",
        })
        if missing:
            coverage["status"] = "fail"
            coverage["missing_local"] += len(missing)
            for key in sorted(missing):
                failure_example(coverage, "missing_local", {
                    "contract": key, "purpose": slot.kind, "at": slot.instant.isoformat(),
                })
        if run is None or not acceptable(run, quotes):
            problem(coverage, "bad_runs", {"purpose": slot.kind, "at": slot.instant.isoformat(),
                                          "status": run["status"] if run else "missing"})
    degraded = [run for run in runs if not acceptable(run, quotes)]
    coverage["degraded_runs"] = [
        {"id": run["id"], "kind": run["capture_kind"], "status": run["status"]} for run in degraded
    ][:20]
    coverage["degraded_run_count"] = len(degraded)
    if coverage["degraded_runs"]:
        coverage["status"] = "fail"
    report["status"] = "fail" if any(s["status"] == "fail" for s in sections.values()) else "pass"
    return report


def read_inputs(config, day: date) -> tuple:
    discovery = []
    with connect(config.azure) as connection:
        connection.timeout = 20
        cursor = connection.cursor()

        def rows(query):
            cursor.execute(query, day.isoformat())
            columns = [column[0] for column in cursor.description]
            return [dict(zip(columns, row, strict=True)) for row in cursor.fetchall()]

        for kind, query in (("vader_contract", TRACKED_QUERY), ("portfolio", POSITION_QUERY)):
            discovery.extend(normalize(row, kind) for row in rows(query))
        vader = rows(COMPARATOR_QUERY)
        portfolio = rows(PORTFOLIO_COMPARATOR_QUERY)
    with psycopg.connect(
        config.postgres, row_factory=dict_row, connect_timeout=10,
        options="-c default_transaction_read_only=on -c statement_timeout=20000 -c timezone=UTC",
    ) as connection:
        runs = connection.execute(RUN_QUERY, (day,)).fetchall()
        quotes = connection.execute(QUOTE_QUERY, (day,)).fetchall()
    return discovery, runs, quotes, vader, portfolio


def execute(config, day: date, output_root: Path) -> int:
    try:
        inputs = read_inputs(config, day) if session_bounds(day) is not None else ([], [], [], [], [])
        report = audit_day(day, *inputs)
    except Exception as error:
        report = {"date": day.isoformat(), "status": "fail",
                  "sections": {name: {"status": "fail", "error": type(error).__name__}
                               for name in ("vader", "portfolio", "coverage")}}
    lines = [f"Options audit {day}: {report['status'].upper()}"]
    for name, result in report["sections"].items():
        lines.append(
            f"{name}: {result['status']} matched={result.get('matched', 0)}/{result.get('expected', 0)} "
            f"missing L/A={result.get('missing_local', 0)}/{result.get('missing_azure', 0)} "
            f"mismatch={result.get('mismatches', 0)}"
            + (f" gross={result['gross_mismatches']}" if result.get("gross_mismatches") else "")
            + (f" broker_unquoted={result['broker_unquoted']}" if result.get("broker_unquoted") else "")
        )
    directory = output_root / "shared" / "logs" / "audit"
    directory.mkdir(parents=True, exist_ok=True)
    path = directory / f"options-{day}.json"
    path.write_text(json.dumps(report, default=str, indent=2) + "\n", encoding="utf-8")
    sent = notify(config, "\n".join(lines))
    report["notification_sent"] = sent
    path.write_text(json.dumps(report, default=str, indent=2) + "\n", encoding="utf-8")
    print("\n".join(lines))
    return 0 if report["status"] == "pass" and sent else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--date", type=date.fromisoformat, default=None)
    arguments = parser.parse_args()
    day = arguments.date or now().astimezone(PACIFIC).date()
    release = Path(__file__).resolve().parent.parent
    return execute(load_config(arguments.config), day, release.parent.parent)


if __name__ == "__main__":
    sys.exit(main())
