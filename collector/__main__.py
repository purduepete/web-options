from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timedelta
import json
import logging
import sys

from .config import load_config
from .model import PACIFIC, Slot, choose_slot, now, slots
from .provider import collect
from .repository import Repository
from .source import discover

LOG = logging.getLogger("collector")


def tick(config, at) -> int:
    if not config.enabled:
        raise ValueError("collector is disabled: broker coexistence approval is required")
    repo = Repository(config.postgres)
    run_id = None
    try:
        if not repo.lock():
            LOG.warning("collector lock busy; no broker connection opened")
            return 0
        day = at.astimezone(PACIFIC).date()
        scheduled = slots(day)
        # Reconcile yesterday's missed close as well as today's preexisting slots.
        repo.reconcile(slots(day - timedelta(days=1)), at)
        repo.reconcile(scheduled, at)
        runs = repo.runs(day)
        active = next(
            (
                Slot(row["capture_kind"], row["scheduled_at"], row["deadline"], day)
                for row in reversed(runs)
                if row["started_at"] is not None
                and row["status"] in ("running", "partial", "failed")
                and at <= row["deadline"]
            ),
            None,
        )
        finished = {
            (row["capture_kind"], row["scheduled_at"]) for row in runs if row["status"] in ("complete", "no_work")
        }
        # A recovery's identity survives subsequent task ticks, even when partial.
        finished |= {
            (row["capture_kind"], row["scheduled_at"])
            for row in runs
            if row["capture_kind"] == "recovery" and row["finished_at"] is not None
        }
        slot = choose_slot(at, scheduled, finished, active)
        repo.heartbeat()
        if slot is None:
            LOG.info("no eligible capture slot; market closed or interval already covered")
            return 0
        run_id = repo.run(slot, at)
        shared_runs = [
            (other, repo.run(other, at)) for other in scheduled
            if other.instant == slot.instant and other.kind != slot.kind
            and at <= other.deadline and (other.kind, other.instant) not in finished
        ]
        discovery, error = "ok", None
        try:
            rows = discover(config.azure, day)
            repo.sync(rows, day)
        except Exception as failure:
            discovery, error = "failed", type(failure).__name__
            LOG.error("universe discovery failed: %s; capture blocked to avoid stale ownership", error)
        contracts = repo.contracts(day) if discovery == "ok" else []
        repo.prepare(run_id, contracts, discovery, error)
        for _, shared_id in shared_runs:
            repo.prepare(shared_id, contracts, discovery, error)
        if discovery == "failed":
            raise RuntimeError("source unavailable; current eligible universe is unknown")
        if contracts:
            asyncio.run(collect(config, repo, run_id, contracts, slot.deadline))
        # Ticks run once a minute, so this is the settle slot's last chance at a live quote.
        if slot.kind == "settle" and now() >= slot.deadline - timedelta(minutes=1):
            filled = repo.fill_from_close(run_id, day)
            if filled:
                LOG.warning("run=%d filled %d unpriced settle contracts from the close run", run_id, filled)
        for other, shared_id in shared_runs:
            repo.share_capture(run_id, shared_id, other.deadline)
            repo.finish(shared_id, now())
        outcome = repo.finish(run_id, now())
        LOG.info("run=%d kind=%s %s", run_id, slot.kind, json.dumps(outcome))
        if outcome["status"] in ("partial", "failed") or discovery == "failed":
            repo.heartbeat("capture_partial" if discovery == "ok" else "discovery_failed")
            return 1
        runs = repo.runs(day)
        # A later completed recovery covers the interval of an earlier partial or missed slot.
        recovered = [row["scheduled_at"] for row in runs if row["capture_kind"] == "recovery" and row["status"] == "complete"]
        unresolved = any(
            row["status"] in ("failed", "partial", "missed")
            and not any(instant >= row["scheduled_at"] for instant in recovered)
            for row in runs
        )
        repo.heartbeat("unresolved_capture" if unresolved else None, clear=not unresolved)
        return 0
    except Exception as error:
        if run_id is not None:
            repo.finish(run_id, now(), failed=True)
        repo.heartbeat(type(error).__name__)
        raise
    finally:
        repo.close()


ERROR_MEANINGS = {
    "discovery_failed": "the eligible option universe could not be loaded",
    "unresolved_capture": "an earlier partial or missed slot today has not been recovered",
    "no_collector_heartbeat": "the collector has never recorded a heartbeat",
}


def unhealthy_reason(health, at) -> str:
    if health is None:
        return "no collector heartbeat recorded"
    beat = health["heartbeat_at"].astimezone(PACIFIC)
    age = (at - health["heartbeat_at"]).total_seconds() / 60
    if age > 5:
        return f"heartbeat overdue, last {beat:%H:%M:%S} ({age:.0f} min ago)"
    error = health["last_error"]
    meaning = ERROR_MEANINGS.get(error, "the collector run raised this error")
    return f"collector reported {error} at {beat:%H:%M:%S} ({meaning})"


def watchdog(config, at) -> int:
    if not config.enabled:
        LOG.info("collector disabled; watchdog not active")
        return 0
    eligible = slots(at.astimezone(PACIFIC).date())
    if not eligible or not eligible[0].instant <= at <= eligible[-1].deadline + timedelta(minutes=5):
        return 0
    try:
        repo = Repository(config.postgres)
    except Exception as error:
        LOG.warning("unhealthy: collector PostgreSQL unavailable (%s)", type(error).__name__)
        return 1
    try:
        health = repo.execute("SELECT * FROM public.collector_health WHERE id=1").fetchone()
        overdue = health is None or at - health["heartbeat_at"] > timedelta(minutes=5)
        error = health["last_error"] if health else None
        # The tick that records capture_partial already exits 1 and retries; a slot that stays
        # degraded becomes unresolved_capture, which still counts here.
        unhealthy = overdue or error not in (None, "capture_partial")
        if unhealthy:
            LOG.warning("unhealthy: %s", unhealthy_reason(health, at))
        return 1 if unhealthy else 0
    finally:
        repo.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Local VADER prices, delta and IV history")
    parser.add_argument("command", choices=("dryrun", "sync", "tick", "status", "watchdog"))
    parser.add_argument("--config", required=True)
    arguments = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    # Provider debug logging may include authorization headers.
    for logger in ("tastytrade", "httpx", "httpcore", "websockets"):
        logging.getLogger(logger).setLevel(logging.CRITICAL)
    config = load_config(arguments.config)
    at = now()
    LOG.info("local time %s", at.astimezone(PACIFIC).isoformat())
    if arguments.command == "dryrun":
        rows = discover(config.azure, at.astimezone(PACIFIC).date())
        print(
            json.dumps(
                {
                    "source_rows": len(rows),
                    "contracts": len({row["contract"].broker_occ for row in rows}),
                    "slots": [
                        {"kind": slot.kind, "at_local": slot.instant.astimezone(PACIFIC).isoformat()}
                        for slot in slots(at.astimezone(PACIFIC).date())
                    ],
                }
            )
        )
        return 0
    if arguments.command == "tick":
        return tick(config, at)
    if arguments.command == "watchdog":
        return watchdog(config, at)
    repo = Repository(config.postgres)
    try:
        if arguments.command == "sync":
            if not repo.lock():
                raise RuntimeError("collector is busy; source sync not started")
            day = at.astimezone(PACIFIC).date()
            rows = discover(config.azure, day)
            repo.sync(rows, day)
            print(
                json.dumps({"source_rows": len(rows), "local_contracts": len(repo.contracts(day)), "broker_calls": 0})
            )
            return 0
        print(
            json.dumps(
                {
                    "runs": repo.runs(at.astimezone(PACIFIC).date()),
                    "health": repo.execute("SELECT * FROM public.collector_health").fetchall(),
                },
                default=lambda value: value.astimezone(PACIFIC).isoformat()
                if isinstance(value, datetime)
                else str(value),
            )
        )
    finally:
        repo.close()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as error:
        # Never print raw connection/provider exceptions, which may contain credentials.
        print(
            f"collector failed: {type(error).__name__}; inspect protected configuration and run status", file=sys.stderr
        )
        sys.exit(1)
