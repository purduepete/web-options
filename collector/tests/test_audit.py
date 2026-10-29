from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from collector.audit import audit_day, compare_values, execute, note, problem, read_inputs, section
from collector.model import slots
from collector.source import normalize

DAY = date(2026, 10, 20)


def fixtures(day=DAY):
    owners = [
        normalize(dict(source_id="vader", contract_key="vader", symbol="TEST",
                       expiration=day, strike=100, report_date=day), "vader_contract"),
        normalize(dict(source_id=1, symbol="TEST", expiration=day, strike=100,
                       is_paper=True, transaction_date=datetime(day.year, day.month, day.day, 19, tzinfo=UTC)),
                  "portfolio"),
        normalize(dict(source_id=2, symbol="TEST", expiration=day, strike=100,
                       is_paper=False, transaction_date=datetime(day.year, day.month, day.day, 19, tzinfo=UTC)),
                  "portfolio"),
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
             for r in runs if r["capture_kind"] in ("close", "settle")]
    portfolio = [dict(transaction_id=i, is_paper=paper, mark="1.05", mid="1.05", delta="-.25")
                 for i, paper in ((1, True), (2, False))]
    return owners, runs, quotes, vader, portfolio


def test_all_sections_pass_with_canonical_multiple_owner_coverage():
    report = audit_day(DAY, *fixtures())
    assert report["status"] == "pass"
    assert report["sections"]["vader"]["matched"] == 1
    assert report["sections"]["vader"]["purposes"] == ["settle"]
    assert report["sections"]["portfolio"]["matched"] == 2
    assert report["sections"]["portfolio"]["local_capture_at"].endswith("12:55:00-07:00")
    assert report["sections"]["coverage"]["distinct_contracts_expected"] == 1
    assert len(report["sections"]["coverage"]["slots"]) == 41


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
    assert report["sections"]["vader"]["missing_azure"] == 1
    assert report["sections"]["portfolio"]["missing_local"] == 0
    assert report["sections"]["portfolio"]["missing_azure"] == 2
    assert report["sections"]["coverage"]["degraded_runs"][0]["status"] == "partial"


def test_portfolio_uses_last_open_session_capture_not_settle():
    owners, runs, quotes, vader, portfolio = fixtures()
    closing = next(r["id"] for r in runs if r["capture_kind"] == "settle")
    for quote in quotes:
        if quote["run_id"] == closing:
            quote["mark_per_share"] = Decimal("9")
    vader[-1]["mark"] = "9"
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["sections"]["portfolio"]["matched"] == 2
    runs[:] = [r for r in runs if not (r["capture_kind"] == "open_session"
                                       and r["scheduled_at"] == max(x["scheduled_at"] for x in runs
                                                                    if x["capture_kind"] == "open_session"))]
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["sections"]["portfolio"]["missing_local"] == 2


def test_contracts_added_after_a_successful_discovery_are_not_misses():
    owners, runs, quotes, vader, portfolio = fixtures()
    late = normalize(dict(source_id="late", contract_key="late", symbol="LATE", expiration=DAY, strike=50,
                          report_date=DAY),
                     "vader_contract")
    owners.append(late)
    for run in runs:
        run["discovery_status"] = "ok"
    for quote in [q for q in quotes if q["run_id"] > 6]:
        quotes.append({**quote, "contract_key": late["contract"].broker_occ})
    report = audit_day(DAY, owners, runs, quotes, vader + [dict(vader[-1], contract_key="late")], portfolio)
    assert report["sections"]["coverage"]["status"] == "pass"
    assert report["sections"]["coverage"]["not_yet_discovered"] == 6
    runs[0]["discovery_status"] = "failed"
    report = audit_day(DAY, owners, runs, quotes, vader + [dict(vader[-1], contract_key="late")], portfolio)
    assert report["sections"]["coverage"]["missing_local"] == 1


def test_broker_unquoted_is_exception_not_failure():
    owners, runs, quotes, vader, portfolio = fixtures()
    for quote in quotes:
        quote.update(price_status="invalid", price_error="invalid_or_missing_bid_ask",
                     mark_per_share=None, mid_per_share=None)
    for run in runs:
        run["status"] = "partial"
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["status"] == "pass"
    assert report["sections"]["coverage"]["broker_unquoted"] == 41
    assert report["sections"]["coverage"]["degraded_run_count"] == 0
    assert report["sections"]["vader"]["broker_unquoted"] == 1
    assert report["sections"]["portfolio"]["broker_unquoted"] == 2


def test_other_quote_failures_still_fail_partial_runs():
    owners, runs, quotes, vader, portfolio = fixtures()
    quotes[0].update(price_status="invalid", price_error="timeout")
    runs[0]["status"] = "partial"
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["status"] == "fail"
    assert report["sections"]["coverage"]["missing_local"] == 1
    assert report["sections"]["coverage"]["degraded_run_count"] == 1


def test_mismatches_and_nonmatching_live_paper_identity():
    data = fixtures()
    data[3][-1]["mark"] = "1.20"
    data[4][0]["is_paper"] = False
    report = audit_day(DAY, *data)
    assert report["sections"]["vader"]["mismatches"] == 1
    assert report["sections"]["portfolio"]["missing_azure"] == 1


def test_value_differences_and_azure_gaps_are_informational():
    owners, runs, quotes, vader, portfolio = fixtures()
    vader[-1]["mark"] = "1.20"
    portfolio[0]["mid"] = "1.30"
    portfolio.pop()
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["status"] == "pass"
    assert report["sections"]["vader"]["status"] == "pass"
    assert report["sections"]["vader"]["mismatches"] == 1
    assert report["sections"]["portfolio"]["status"] == "pass"
    assert report["sections"]["portfolio"]["mismatches"] == 1
    assert report["sections"]["portfolio"]["missing_azure"] == 1
    assert len(report["sections"]["portfolio"]["examples"]) == 2


@pytest.mark.parametrize(("field", "value"), [("mark", "2"), ("mid", "0"), ("delta", "-.45")])
def test_gross_value_differences_fail(field, value):
    owners, runs, quotes, vader, portfolio = fixtures()
    vader[-1][field] = value
    portfolio[0][field] = value
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["status"] == "fail"
    for name in ("vader", "portfolio"):
        assert report["sections"][name]["status"] == "fail"
        assert report["sections"][name]["gross_mismatches"] == 1


def test_gross_limits_scale_with_price_and_cover_missing_local_values():
    local = dict(mid_per_share="20", mark_per_share="20", delta="-.5", implied_volatility_fraction="4")
    source = dict(mid="24.9", mark="15.1", delta="-.36", implied_volatility="11")
    assert not any(d["gross"] for d in compare_values(local, source))
    source["mid"] = "26.8"
    assert not any(d["gross"] for d in compare_values(local, source))
    assert [d["field"] for d in compare_values({**local, "delta": None}, source) if d["gross"]] == ["delta"]
    source["mark"] = "14.9"
    assert [d["field"] for d in compare_values(local, source) if d["gross"]] == ["mid", "mark"]
    assert [d["field"] for d in compare_values({**local, "delta": None}, source) if d["gross"]] == [
        "mid", "mark", "delta"
    ]
    assert not any(d["gross"] for d in compare_values(local, {**source, "mid": None, "mark": "20"})
                   if d["field"] != "delta")


def test_gross_mid_outlier_is_informational_when_marks_reconcile():
    local = dict(mid_per_share="5.35", mark_per_share="5.35", delta="-.33",
                 implied_volatility_fraction=".4")
    source = dict(mid="7.15", mark="5.497866", delta="-.33", implied_volatility=".4")
    differences = compare_values(local, source)
    mid = next(difference for difference in differences if difference["field"] == "mid")
    assert mid["gross"] is False
    assert mid["reason"] == "marks_within_gross_price_threshold"

    owners, runs, quotes, vader, portfolio = fixtures()
    settle_quote = next(quote for quote, run in zip(quotes, runs) if run["capture_kind"] == "settle")
    settle_quote.update(mid_per_share="5.35", mark_per_share="5.35")
    vader[-1].update(mid="7.15", mark="5.497866")
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["status"] == "pass"
    assert report["sections"]["vader"]["mismatches"] == 1
    assert report["sections"]["vader"].get("gross_mismatches", 0) == 0

    source["mark"] = "7.15"
    differences = compare_values(local, source)
    assert next(difference for difference in differences if difference["field"] == "mid")["gross"] is True
    assert next(difference for difference in differences if difference["field"] == "mark")["gross"] is True


def test_zero_mid_remains_gross_even_when_marks_reconcile():
    local = dict(mid_per_share="0", mark_per_share="1.05", delta="-.25",
                 implied_volatility_fraction=".4")
    source = dict(mid="1.05", mark="1.05", delta="-.25", implied_volatility=".4")
    mid = next(difference for difference in compare_values(local, source) if difference["field"] == "mid")
    assert mid["gross"] is True


@pytest.mark.parametrize("value", [None, "NaN", "Infinity", "-1"])
def test_invalid_mid_is_not_excused_by_agreeing_marks(value):
    local = dict(mid_per_share=value, mark_per_share="1.05")
    source = dict(mid="1.05", mark="1.05")
    mid = next(difference for difference in compare_values(local, source) if difference["field"] == "mid")
    assert mid["gross"] is True


def test_historical_rerun_excludes_future_owners_from_every_section():
    owners, runs, quotes, vader, portfolio = fixtures()
    tomorrow = DAY + timedelta(days=1)
    owners.extend([
        normalize(dict(source_id="future", contract_key="future", symbol="LATE", expiration=tomorrow,
                       strike=50, report_date=tomorrow), "vader_contract"),
        normalize(dict(source_id=3, symbol="LATE", expiration=tomorrow, strike=50, is_paper=False,
                       transaction_date=datetime(tomorrow.year, tomorrow.month, tomorrow.day, 15, tzinfo=UTC)),
                  "portfolio"),
    ])
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    assert report["status"] == "pass"
    assert report["sections"]["vader"]["expected"] == 1
    assert report["sections"]["portfolio"]["expected"] == 2
    assert report["sections"]["vader"]["introduced_after_session"] == 1
    assert report["sections"]["portfolio"]["introduced_after_session"] == 1
    assert report["sections"]["coverage"]["distinct_contracts_expected"] == 1


def test_transaction_dates_use_the_pacific_session_date():
    data = fixtures()
    # Early the next UTC day is still the audited Pacific day.
    data[0][1]["transaction_date"] = datetime(2026, 10, 21, 1)
    report = audit_day(DAY, *data)
    assert report["status"] == "pass"
    assert report["sections"]["portfolio"]["expected"] == 2


@pytest.mark.parametrize(("index", "field", "section_name"), [
    (0, "report_date", "vader"), (1, "transaction_date", "portfolio"),
])
def test_missing_source_dates_fail_without_silently_excluding_owners(index, field, section_name):
    data = fixtures()
    data[0][index].pop(field)
    report = audit_day(DAY, *data)
    assert report["status"] == "fail"
    assert report["sections"][section_name]["invalid_source_date"] == 1


@pytest.mark.parametrize(("local", "source", "expected"), [
    (dict(mid_per_share="0"), dict(mid=".40"), True),
    (dict(mid_per_share="0"), dict(mid=".04"), False),
    (dict(mark_per_share="-.10"), dict(mark="0"), True),
    (dict(delta="1.20"), dict(delta=".98"), True),
    (dict(delta=".07"), dict(delta="-.07"), True),
    (dict(delta=".03"), dict(delta="-.02"), False),
])
def test_invalid_local_values_are_gross_even_inside_the_drift_limits(local, source, expected):
    field = next(iter(source))
    assert [d["gross"] for d in compare_values(local, source) if d["field"] == field] == [expected]


def test_losing_most_azure_comparisons_fails_the_section():
    owners, runs, quotes, vader, portfolio = fixtures()
    vader.clear()
    portfolio.clear()
    report = audit_day(DAY, owners, runs, quotes, vader, portfolio)
    for name in ("vader", "portfolio"):
        assert report["sections"][name]["status"] == "fail"
        assert report["sections"][name]["low_comparison_coverage"] == 1


def test_early_close_and_time_distance_missing_azure():
    day = date(2026, 11, 27)
    data = fixtures(day)
    data[3].pop()
    report = audit_day(day, *data)
    assert len(report["sections"]["coverage"]["slots"]) == 23
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
    assert report["sections"]["vader"]["missing_local"] == 100
    assert len(report["sections"]["vader"]["examples"]) == 20
    assert sum(failure["reason"] == "missing_local"
               for failure in report["sections"]["vader"]["failures"]) == 100
    assert any(failure["reason"] == "low_comparison_coverage"
               for failure in report["sections"]["vader"]["failures"])


def test_failures_remain_in_examples_after_informational_examples_fill_the_cap():
    result = section()
    for index in range(20):
        note(result, "mismatches", {"index": index})
    problem(result, "gross_mismatches", {"contract": "SOXX"})

    assert len(result["examples"]) == 20
    assert result["examples"][-1] == {"reason": "gross_mismatches", "contract": "SOXX"}
    assert result["failures"] == [{"reason": "gross_mismatches", "contract": "SOXX"}]


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
    assert "New-ScheduledTaskTrigger -Daily -At '13:30'" in installer
    assert "-ExecutionTimeLimit (New-TimeSpan -Minutes 15)" in installer
    assert "NT AUTHORITY\\LOCAL SERVICE" in installer
