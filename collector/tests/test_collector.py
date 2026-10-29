from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

from collector.__main__ import tick
from collector.config import Config
from collector.model import Contract, choose_slot, event_time, number, slots
from collector.provider import price_values, quality
from collector.repository import Repository
from collector.source import QUERY
from psycopg.conninfo import conninfo_to_dict


def test_regular_session_slots():
    result = slots(date(2026, 10, 20))
    assert len(result) == 41
    assert result[0].instant == datetime(2026, 10, 20, 13, 35, tzinfo=UTC)
    assert result[-2].kind == "close"
    assert result[-2].instant == datetime(2026, 10, 20, 20, tzinfo=UTC)
    assert result[-1].kind == "settle"
    intraday = result[:-2]
    assert all(s.instant.minute % 10 == 5 for s in intraday)
    assert all(b.instant - a.instant == timedelta(minutes=10) for a, b in zip(intraday, intraday[1:]))
    assert intraday[-1].deadline == result[-2].instant


def test_calendar_holiday_weekend_early_close_and_dst():
    holiday = slots(date(2026, 12, 25))
    assert len(holiday) == 1 and holiday[0].kind == "settle"
    assert slots(date(2026, 10, 24)) == []
    early = slots(date(2026, 11, 27))
    assert len(early) == 23
    assert early[-2].instant == datetime(2026, 11, 27, 18, tzinfo=UTC)
    assert early[-1].instant == datetime(2026, 11, 27, 21, 10, tzinfo=UTC)
    assert choose_slot(early[-2].deadline + timedelta(minutes=1), early, set()) is None
    assert slots(date(2026, 11, 2))[0].instant.hour == 14
    assert slots(date(2026, 10, 30))[0].instant.hour == 13


def test_close_window_inclusive_and_no_after_hours_recovery():
    scheduled = slots(date(2026, 10, 20))
    close = scheduled[-1]
    assert choose_slot(close.deadline, scheduled, set()) == close
    assert choose_slot(close.deadline + timedelta(seconds=1), scheduled, set()) is None


def test_recovery_once_per_uncovered_interval_and_retry_identity():
    scheduled = slots(date(2026, 10, 20))
    at = scheduled[0].instant + timedelta(minutes=7)
    recovery = choose_slot(at, scheduled, set())
    assert recovery.kind == "recovery"
    assert choose_slot(at + timedelta(minutes=1), scheduled, set(), recovery) == recovery
    assert choose_slot(at + timedelta(minutes=2), scheduled, {("recovery", recovery.instant)}) is None
    assert choose_slot(scheduled[1].instant, scheduled, {("recovery", recovery.instant)}) == scheduled[1]


def test_no_slot_or_recovery_between_open_and_first_offset_slot():
    scheduled = slots(date(2026, 10, 20))
    opened = datetime(2026, 10, 20, 13, 30, tzinfo=UTC)
    assert choose_slot(opened, scheduled, set()) is None
    assert choose_slot(opened + timedelta(minutes=4, seconds=59), scheduled, set()) is None
    assert choose_slot(opened + timedelta(minutes=5), scheduled, set()) == scheduled[0]


@pytest.mark.parametrize("value", [None, "NaN", "Infinity", "-Infinity", -0.1, True])
def test_invalid_prices(value):
    assert number(value) is None


def test_greeks_units_and_zero():
    assert number("-0.25", delta=True) == Decimal("-0.25")
    assert number("0", delta=True) == 0
    assert number("0") == 0
    assert number("2.50") == Decimal("2.50")
    assert number("0.1", delta=True) is None
    assert number("-1.0001", delta=True) is None


def test_occ_and_streamer_mapping():
    contract = Contract("key", "BRK.B", date(2026, 11, 20), Decimal("412.5"))
    assert contract.occ == "BRK.B 261120P00412500"
    assert contract.broker_occ == "BRKB  261120P00412500"
    assert contract.streamer_symbol == ".BRKB261120P412.5"
    with pytest.raises(ValueError):
        _ = Contract("key", "TOOLONG", date(2026, 11, 20), Decimal("1")).occ


@pytest.mark.parametrize("symbol", ["BRK-B", "BRK.B", "BRKB"])
def test_berkshire_broker_alias_preserves_source_identity(symbol):
    contract = Contract("source-key", symbol, date(2026, 11, 20), Decimal("500"))
    assert contract.symbol == symbol
    assert contract.key == "source-key"
    assert contract.occ == f"{symbol:<6}261120P00500000"
    assert contract.broker_occ == "BRKB  261120P00500000"
    assert contract.broker_underlying == "BRK/B"
    assert contract.streamer_symbol == ".BRKB261120P500"


def test_source_uses_signal_hash_not_nonexistent_numeric_id():
    assert "s.signal_key AS source_id" in QUERY
    assert "s.id" not in QUERY
    assert "s.report_date >=" not in QUERY
    assert "s.option_right = 'P'" in QUERY


def test_windows_passfile_escapes_survive_libpq_parsing():
    example = json.loads((Path(__file__).resolve().parents[1] / "config.example.json").read_text())
    path = conninfo_to_dict(example["postgres"])["passfile"]
    assert (
        path == r"C:\ProgramData\SolutionDeploy\apps\web-options\shared\secrets\collector\sd_web_options_runtime.pgpass"
    )


def test_quote_validation_and_units():
    at = datetime.now(UTC)
    quote = SimpleNamespace(bid="1.10", ask="1.30", mark="1.20", last=0, updated_at=at)
    result = price_values(quote, at)
    assert result["mid"] == Decimal("1.20")
    assert result["last"] == 0
    assert result["status"] == "ok"
    quote.bid = "1.40"
    assert price_values(quote, at)["status"] == "invalid"
    assert "crossed" in price_values(quote, at)["flags"]
    quote.updated_at = None
    assert "provider_time_missing" in price_values(quote, at)["flags"]
    assert quality(at - timedelta(minutes=6), at) == ["stale"]


def test_timestamps_do_not_invent_provider_time():
    assert event_time(0) is None
    assert event_time(datetime(2026, 1, 1)) is None
    assert event_time(1_800_000_000_000).tzinfo is UTC


def test_persistence_immutable_component_guard_and_late_isolation():
    repo = Repository.__new__(Repository)
    repo.execute = MagicMock()
    at = datetime.now(UTC)
    values = {"received_at": at, "event_time": None, "value": Decimal("-0.2"), "flags": []}
    repo.save(1, "key", "delta", values, at + timedelta(seconds=1))
    query, _ = repo.execute.call_args.args
    text = query.as_string()
    assert '"delta" IS NULL' in text and "\"delta_status\"='missing'" in text
    repo.execute.reset_mock()
    repo.save(1, "key", "delta", values, at - timedelta(seconds=1))
    assert "broker_quote_diagnostic" in repo.execute.call_args.args[0]
    assert "UPDATE public.broker_option_quote" not in repo.execute.call_args.args[0]


def test_busy_lock_opens_no_provider():
    config = Config("", {}, "", "", True, {})
    with patch("collector.__main__.Repository") as factory, patch("collector.__main__.collect") as capture:
        factory.return_value.lock.return_value = False
        assert tick(config, datetime.now(UTC)) == 0
        capture.assert_not_called()
        factory.return_value.close.assert_called_once()


def test_activation_fail_closed():
    with pytest.raises(ValueError, match="disabled"):
        tick(Config("", {}, "", "", False, {}), datetime.now(UTC))


@pytest.mark.parametrize("has_contracts", [True, False])
def test_azure_outage_blocks_stale_ownership_capture(has_contracts):
    config = Config("", {}, "", "", True, {})
    at = datetime(2026, 10, 20, 13, 35, tzinfo=UTC)
    with (
        patch("collector.__main__.Repository") as factory,
        patch("collector.__main__.discover", side_effect=RuntimeError("sensitive")),
        patch("collector.__main__.collect") as capture,
    ):
        repo = factory.return_value
        repo.lock.return_value = True
        repo.runs.return_value = []
        repo.run.return_value = 1
        repo.contracts.return_value = [MagicMock()] if has_contracts else []
        repo.finish.return_value = {"status": "complete", "expected": 1}
        with pytest.raises(RuntimeError, match="current eligible universe is unknown"):
            tick(config, at)
        capture.assert_not_called()

@pytest.mark.parametrize(
    ("error", "age", "expected", "logged"),
    [
        ("capture_partial", 1, 0, None),
        (None, 1, 0, None),
        ("unresolved_capture", 1, 1, "collector reported unresolved_capture at 13:11:00 "
         "(an earlier partial or missed slot today has not been recovered)"),
        ("capture_partial", 7, 1, "heartbeat overdue, last 13:05:00 (7 min ago)"),
    ],
)
def test_watchdog_logs_reason_and_leaves_partial_to_tick(caplog, error, age, expected, logged):
    from collector.__main__ import watchdog

    at = datetime(2026, 10, 28, 20, 12, tzinfo=UTC)
    beat = at - timedelta(minutes=age)
    config = Config("", {}, "", "", True, {})
    with patch("collector.__main__.Repository") as factory:
        factory.return_value.execute.return_value.fetchone.return_value = {
            "heartbeat_at": beat, "last_error": error,
        }
        with caplog.at_level("WARNING", logger="collector"):
            assert watchdog(config, at) == expected
    warnings = [record.getMessage() for record in caplog.records if record.levelname == "WARNING"]
    assert warnings == ([f"unhealthy: {logged}"] if logged else [])


def test_watchdog_logs_database_outage_without_notifying(caplog):
    from collector.__main__ import watchdog

    at = datetime(2026, 10, 28, 20, 12, tzinfo=UTC)
    with patch("collector.__main__.Repository", side_effect=RuntimeError("secret")):
        with caplog.at_level("WARNING", logger="collector"):
            assert watchdog(Config("", {}, "", "", True, {}), at) == 1
    assert [record.getMessage() for record in caplog.records] == [
        "unhealthy: collector PostgreSQL unavailable (RuntimeError)"
    ]
