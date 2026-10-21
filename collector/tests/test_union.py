from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from collector.__main__ import tick
from collector.config import Config
from collector.model import PACIFIC, Contract, Slot, choose_slot, slots
from collector.repository import Repository
from collector.source import POSITION_QUERY, QUERY, TRACKED_QUERY, normalize


@pytest.mark.parametrize("day", [date(2026, 10, 20), date(2026, 11, 27), date(2026, 12, 25)])
def test_close_purposes_have_full_windows(day):
    for slot in slots(day):
        if slot.kind in ("close", "closing_1315"):
            assert slot.deadline - slot.instant == timedelta(minutes=5)
            assert choose_slot(slot.instant + timedelta(minutes=4, seconds=59), slots(day), set()) == slot
    assert all(s.instant.astimezone(PACIFIC).hour != 13 or s.kind == "closing_1315"
               for s in slots(date(2026, 11, 27)))


def test_only_preclose_windows_clip():
    opened = datetime(2026, 10, 20, 13, 30, tzinfo=UTC)
    closed = opened + timedelta(minutes=32)
    with patch("collector.model.session_bounds", return_value=(opened, closed)):
        scheduled = slots(date(2026, 10, 20))
    assert scheduled[1].deadline == closed
    assert scheduled[2].deadline == closed + timedelta(minutes=5)


def test_source_filters_and_owner_identity():
    assert "status = 'open'" in POSITION_QUERY
    assert "action = 'sell_to_open'" in POSITION_QUERY
    assert "is_paper IN (0, 1)" in POSITION_QUERY
    assert "expiration_date >= CAST(? AS date)" in POSITION_QUERY
    assert "expiration >= CAST(? AS date)" in TRACKED_QUERY
    assert "s.strategy_type = 'CSP'" in QUERY
    row = normalize(dict(source_id=42, symbol="BRK.B", expiration=date(2026, 10, 20),
                         strike=Decimal("400"), authenticated_user_id=3, account_id=9,
                         is_paper=True, transaction_date="2026-10-20"), "portfolio")
    assert row["source_id"] == "42"
    assert row["authenticated_user_id"] == 3 and row["is_paper"]
    assert row["contract"].broker_occ == "BRKB  261020P00400000"
    assert row["contract"].key == "portfolio:42"


def test_contract_selection_requires_current_owners_and_includes_expiry_day():
    repo = Repository.__new__(Repository)
    repo.execute = MagicMock()
    repo.execute.return_value.fetchall.return_value = []
    repo.contracts(date(2026, 10, 20))
    query, args = repo.execute.call_args.args
    assert "c.expiration >= %s" in query and "o.source_current" in query
    assert args == (date(2026, 10, 20),)


def test_sync_maps_multiple_owners_without_fabricating_signals():
    repo = Repository.__new__(Repository)
    repo.connection = MagicMock()
    repo.execute = MagicMock()
    rows = [
        normalize(dict(source_id=i, symbol=symbol, expiration=date(2026, 10, 20),
                       strike=400, authenticated_user_id=i, account_id=i,
                       is_paper=bool(i % 2)), "portfolio")
        for i, symbol in enumerate(("BRK.B", "BRK-B", "BRKB"), start=1)
    ]
    repo.sync(rows, date(2026, 10, 20))
    calls = repo.execute.call_args_list
    owners = [call.args[1] for call in calls if "INSERT INTO public.option_owner" in call.args[0]]
    assert len(owners) == 3
    assert len({owner[2] for owner in owners}) == 1
    assert {owner[1] for owner in owners} == {"1", "2", "3"}
    assert not any("INSERT INTO public.vader_signal" in call.args[0] for call in calls)
    repo.prepare(7, [Contract("BRKB  261020P00400000", "BRKB", date(2026, 10, 20), Decimal(400))], "ok", None)
    assert any("INSERT INTO public.option_capture_owner" in call.args[0] for call in repo.execute.call_args_list)


def test_holiday_1315_attempts_discovery_and_provider():
    at = datetime(2026, 12, 25, 21, 16, tzinfo=UTC)
    config = Config("", {}, "", "", True, {})
    with (patch("collector.__main__.Repository") as factory,
          patch("collector.__main__.discover", return_value=[] ) as discovery,
          patch("collector.__main__.collect") as capture):
        repo = factory.return_value
        repo.lock.return_value = True
        repo.runs.return_value = []
        repo.run.return_value = 1
        repo.contracts.return_value = [Contract("x", "TEST", date(2026, 12, 25), Decimal(100))]
        repo.finish.return_value = {"status": "partial"}
        assert tick(config, at) == 1
        discovery.assert_called_once_with({}, date(2026, 12, 25))
        capture.assert_called_once()


def test_pacific_date_survives_utc_date_rollover():
    slot = Slot("closing_1315", datetime(2026, 10, 20, 20, 15, tzinfo=UTC),
                datetime(2026, 10, 20, 20, 20, tzinfo=UTC), date(2026, 10, 20))
    assert slot.session == slot.instant.astimezone(PACIFIC).date()
    assert datetime(2026, 10, 21, 1, tzinfo=UTC).astimezone(PACIFIC).date() == slot.session


def test_restart_uses_original_run_deadline_and_only_missing_components():
    config = Config("", {}, "", "", True, {})
    scheduled = slots(date(2026, 10, 20))
    slot = scheduled[-1]
    at = slot.instant + timedelta(minutes=3)
    run = dict(capture_kind=slot.kind, scheduled_at=slot.instant, deadline=slot.deadline,
               started_at=slot.instant, finished_at=at - timedelta(minutes=1), status="partial")
    with (patch("collector.__main__.Repository") as factory,
          patch("collector.__main__.discover", return_value=[]),
          patch("collector.__main__.collect") as capture):
        repo = factory.return_value
        repo.lock.return_value = True
        repo.runs.return_value = [run]
        repo.run.return_value = 8
        repo.contracts.return_value = [Contract("x", "TEST", slot.session, Decimal(100))]
        repo.finish.return_value = {"status": "complete"}
        assert tick(config, at) == 0
        assert repo.run.call_args.args[0] == slot
        assert capture.call_args.args[-1] == slot.deadline
        repo.heartbeat.assert_called_with("unresolved_capture", clear=False)


def test_coincident_purposes_share_one_provider_attempt():
    day = date(2026, 10, 20)
    at = datetime(2026, 10, 20, 20, 15, tzinfo=UTC)
    scheduled = [Slot(kind, at, at + timedelta(minutes=5), day) for kind in ("close", "closing_1315")]
    with (patch("collector.__main__.Repository") as factory,
          patch("collector.__main__.slots", return_value=scheduled),
          patch("collector.__main__.discover", return_value=[]),
          patch("collector.__main__.collect") as capture):
        repo = factory.return_value
        repo.lock.return_value = True
        repo.runs.return_value = []
        repo.run.side_effect = [10, 11]
        repo.contracts.return_value = [Contract("x", "TEST", day, Decimal(100))]
        repo.finish.return_value = {"status": "complete"}
        assert tick(Config("", {}, "", "", True, {}), at) == 0
        capture.assert_called_once()
        assert repo.prepare.call_count == 2 and repo.finish.call_count == 2
        repo.share_capture.assert_called_once_with(10, 11, scheduled[1].deadline)


def test_migration_is_additive_rerunnable_and_preserves_old_history():
    sql = (Path(__file__).resolve().parents[2] / "database" / "postgres" /
           "002_combined_option_universe.sql").read_text()
    assert "SET LOCAL lock_timeout = '5s'" in sql
    assert "SET LOCAL statement_timeout = '30s'" in sql
    assert "DROP TABLE" not in sql and "TRUNCATE" not in sql and "DELETE FROM" not in sql
    assert sql.count("CREATE TABLE IF NOT EXISTS") == 6
    assert "ON CONFLICT DO NOTHING" in sql
    assert "REFERENCES public.broker_option_quote" in sql
    assert "GRANT SELECT,INSERT ON public.option_capture_owner" in sql
    check = sql.index("CHECK (capture_kind IN")
    validate = sql.index("VALIDATE CONSTRAINT")
    assert "NOT VALID;" in sql[check:validate]
    assert "COMMIT;" in sql[check:validate]
    assert sql.count("SET LOCAL lock_timeout = '5s'") == 2
    assert sql.count("SET LOCAL statement_timeout = '30s'") == 2
    assert "GRANT UPDATE (synced_at) ON public.broker_contract" in sql
    assert "REVOKE UPDATE ON public.broker_contract" in sql


def test_activation_probe_checks_new_schema_and_immutable_evidence_rights():
    source = (Path(__file__).resolve().parents[1] / "verify_database.py").read_text()
    assert "versions != {1, 2}" in source
    for table in ("broker_contract", "option_owner", "broker_option_quote",
                  "option_capture_owner", "broker_quote_diagnostic", "azure_option_observation"):
        assert f"'{table}'" in source
    assert "'UPDATE') <> can_update" in source
    assert "'TRUNCATE')" in source
    assert "t.tableowner=current_user" in source
    assert "'broker_contract',false" in source
    assert "has_column_privilege" in source
    assert "<> (column_name='synced_at')" in source
    assert "SELECT convalidated FROM pg_constraint" in source
    assert "validated != (True,)" in source
