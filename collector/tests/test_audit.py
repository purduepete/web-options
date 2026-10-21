from datetime import date, timedelta
from decimal import Decimal
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from collector.audit import audit_day, compare_values, execute, read_inputs
from collector.model import slots
from collector.source import normalize

DAY = date(2026, 10, 20)


def fixtures(day=DAY):
    owners = [
        normalize(dict(source_id="vader", contract_key="vader", symbol="TEST",
                       expiration=day, strike=100), "vader_contract"),
        normalize(dict(source_id=1, symbol="TEST", expiration=day, strike=100,
                       is_paper=True), "portfolio"),
        normalize(dict(source_id=2, symbol="TEST", expiration=day, strike=100,
                       is_paper=False), "portfolio"),
    ]
    runs, quotes = [], []
    for index, slot in enumerate(slots(day), start=1):
        runs.append(dict(id=index, capture_kind=slot.kind, scheduled_at=slot.instant, status="complete"))
        quotes.append(dict(run_id=index, contract_key=owners[0]["contract"].broker_occ,
                           price_received_at=slot.instant + timedelta(seconds=30),
                           price_status="ok", delta_status="ok", iv_status="ok",
                           mark_per_share=Decimal("1.05"), mid_per_share=Decimal("1.05"),
                           delta=Decimal("-.25"), implied_volatility_fraction=Decimal(".4")))
    vader = [dict(contract_key="vader ", captured_at_utc=r["scheduled_at"].replace(tzinfo=None),
                  mark="1.05", mid="1.05", delta="-.25", implied_volatility=".4")
             for r in runs if r["capture_kind"] in ("close", "closing_1315")]
    portfolio = [dict(transaction_id=i, is_paper=paper, mark="1.05", mid="1.05", delta="-.25")
                 for i, paper in ((1, True), (2, False))]
    return owners, runs, quotes, vader, portfolio


def test_all_sections_pass_with_canonical_multiple_owner_coverage():
    report = audit_day(DAY, *fixtures())
    assert report["status"] == "pass"
    assert report["sections"]["vader"]["matched"] == 2
    assert report["sections"]["portfolio"]["matched"] == 2
    assert report["sections"]["coverage"]["distinct_contracts_expected"] == 1
    assert len(report["sections"]["coverage"]["slots"]) == 15


def test_nearest_same_time_row_selected_not_last_row():
    data = fixtures()
    data[3].append({**data[3][0], "captured_at_utc": data[3][0]["captured_at_utc"] - timedelta(hours=1),
                    "mark": "99"})
    assert audit_day(DAY, *data)["status"] == "pass"


def test_value_tolerances_and_missing_fields():
    local = dict(mid_per_share="1", mark_per_share="1", delta="-.25", implied_volatility_fraction=".4")
    source = dict(mid="1.01", mark=".99", delta="-.26", implied_volatility=".42")
    assert compare_values(local, source) == []
    source["implied_volatility"] = ".42001"
    assert compare_values(local, source)[0]["field"] == "implied_volatility"
    assert compare_values(local, source, portfolio=True) == []
    assert len(compare_values({}, {})) == 4


def test_missing_local_azure_and_partial_runs_fail():
    owners, runs, quotes, vader, portfolio = fixtures()
    runs[-1]["status"] = "partial"
    quotes.pop()
    vader.clear()
    portfolio.clear()
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["status"] == "fail"
    assert report["sections"]["vader"]["missing_local"] == 1
    assert report["sections"]["vader"]["missing_azure"] == 2
    assert report["sections"]["portfolio"]["missing_local"] == 2
    assert report["sections"]["portfolio"]["missing_azure"] == 2
    assert report["sections"]["coverage"]["degraded_runs"][0]["status"] == "partial"


def test_mismatches_and_nonmatching_live_paper_identity():
    data = fixtures()
    data[3][0]["mark"] = "2"
    data[4][0]["is_paper"] = False
    report = audit_day(DAY, *data)
    assert report["sections"]["vader"]["mismatches"] == 1
    assert report["sections"]["portfolio"]["missing_azure"] == 1


def test_early_close_and_time_distance_missing_azure():
    day = date(2026, 11, 27)
    data = fixtures(day)
    data[3].pop(0)
    report = audit_day(day, *data)
    assert len(report["sections"]["coverage"]["slots"]) == 9
    assert report["sections"]["vader"]["missing_azure"] == 1


@pytest.mark.parametrize("day", [date(2026, 10, 24), date(2026, 12, 25)])
def test_non_sessions_not_run_and_do_not_read_databases(day, tmp_path):
    config = MagicMock()
    with patch("collector.audit.read_inputs") as read, patch("collector.audit.notify", return_value=True) as notify:
        assert execute(config, day, tmp_path) == 0
    read.assert_not_called()
    notify.assert_called_once()
    assert notify.call_args.args[1].startswith(f"Options audit {day}: PASS\n")
    report = json.loads((tmp_path / "shared" / "logs" / "audit" / f"options-{day}.json").read_text())
    assert all(s["status"] == "not_run" for s in report["sections"].values())


def test_error_sends_exactly_one_sanitized_failure_notification(tmp_path):
    with (patch("collector.audit.read_inputs", side_effect=RuntimeError("secret")),
          patch("collector.audit.notify", return_value=True) as notify):
        assert execute(MagicMock(), DAY, tmp_path) == 1
    assert notify.call_count == 1
    assert notify.call_args.args[1].startswith(f"Options audit {DAY}: FAIL\n")
    text = (tmp_path / "shared" / "logs" / "audit" / f"options-{DAY}.json").read_text()
    assert "secret" not in text and "RuntimeError" in text


def test_failure_examples_are_capped_and_missing_runs_fail():
    owners, _, _, _, _ = fixtures()
    owners = [{**owners[0], "source_id": str(i)} for i in range(100)]
    report = audit_day(DAY, owners, [], [], [], [])
    assert report["status"] == "fail"
    assert report["sections"]["vader"]["missing_local"] == 200
    assert len(report["sections"]["vader"]["examples"]) == 20


def test_audit_readonly_queries_no_repository_writes():
    azure = MagicMock()
    azure.cursor.return_value.description = []
    azure.cursor.return_value.fetchall.return_value = []
    postgres = MagicMock()
    postgres.execute.return_value.fetchall.return_value = []
    with (patch("collector.audit.connect") as az, patch("collector.audit.psycopg.connect") as pg):
        az.return_value.__enter__.return_value = azure
        pg.return_value.__enter__.return_value = postgres
        assert read_inputs(MagicMock(), DAY) == ([], [], [], [], [])
    assert "default_transaction_read_only=on" in pg.call_args.kwargs["options"]
    assert len(azure.cursor.return_value.execute.call_args_list) == 4
    assert len(postgres.execute.call_args_list) == 2
    for call in azure.cursor.return_value.execute.call_args_list + postgres.execute.call_args_list:
        assert call.args[0].strip().startswith("SELECT")


def test_task_launcher_and_daily_registration_contract():
    root = Path(__file__).resolve().parents[2]
    launcher = (root / "scripts" / "Start-Collector.ps1").read_text()
    installer = (root / "scripts" / "Install-CollectorTasks.ps1").read_text()
    assert "'audit')" in launcher
    assert "-m collector.audit --config $config" in launcher
    assert "SolutionDeploy-web-options-daily-audit" in installer
    assert "New-ScheduledTaskTrigger -Daily -At '23:30'" in installer
    assert "-ExecutionTimeLimit (New-TimeSpan -Minutes 15)" in installer
    assert "NT AUTHORITY\\LOCAL SERVICE" in installer
