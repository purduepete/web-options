from datetime import UTC, datetime, timedelta
from decimal import Decimal
from unittest.mock import MagicMock, patch

from collector.compare import assess, compare
from collector.config import Config


def test_offhours_numeric_agreement_keeps_unknown_date_gate_separate():
    scheduled = datetime(2026, 10, 20, 20, 15, tzinfo=UTC)
    run = dict(capture_kind="settle", scheduled_at=scheduled, deadline=scheduled + timedelta(minutes=5))
    local = dict(price_received_at=scheduled, mark_per_share=Decimal("1.1200001"), delta=None)
    source = dict(captured_at_utc=scheduled.replace(tzinfo=None), market_session="regular_close",
                  mark="1.12", delta="-.250000")
    result = assess(run, local, source, scheduled + timedelta(seconds=30))
    assert result["status"] == "inconclusive"
    assert result["fields"]["mark"] == "numeric_match"
    assert result["fields"]["delta"] == "local_coverage_failure"
    assert result["fields"]["bid"] == "both_missing"
    assert result["reasons"] == ["field_session_dates_unverified"]
    late = assess(run, local, source, scheduled + timedelta(seconds=61))
    assert "receipt_distance_over_60s" in late["reasons"]


def test_wrong_source_run_and_purpose_cannot_prove_parity():
    at = datetime(2026, 10, 20, 20, 15, tzinfo=UTC)
    result = assess(dict(capture_kind="close", scheduled_at=at, deadline=at + timedelta(minutes=5)),
                    {}, dict(captured_at_utc=at - timedelta(hours=1), market_session="holiday"), at)
    assert "source_run_unverified" in result["reasons"]
    assert "source_purpose_unverified" in result["reasons"]
    assert result["status"] == "inconclusive"


def test_existing_comparator_is_immutable_and_never_refetched():
    repo = MagicMock()
    at = datetime(2026, 10, 20, 20, 15, tzinfo=UTC)
    run = dict(capture_kind="settle", scheduled_at=at,
               deadline=at + timedelta(minutes=5), session_date=at.date())
    observation = dict(source_key="original", source_payload={"missing": True}, observed_at=at)
    repo.execute.return_value.fetchone.side_effect = [run, {}]
    repo.execute.return_value.fetchall.side_effect = [
        [{"original_contract_key": "original"}], [], [observation],
    ]
    with patch("collector.compare.comparator_rows") as source:
        result = compare(Config("", {}, "", "", False, {}), repo, 7)
    source.assert_not_called()
    assert result["tracked_1315"][0]["reasons"][0] == "azure_missing"
    assert not any("INSERT" in call.args[0] for call in repo.execute.call_args_list)


def test_portfolio_daily_row_never_claims_a_halfhour_run_and_uses_four_decimal_delta():
    at = datetime(2026, 10, 20, 17, 30, tzinfo=UTC)
    result = assess(
        dict(capture_kind="open_session", scheduled_at=at, deadline=at + timedelta(minutes=5)),
        dict(price_received_at=at, delta=Decimal("-.123449")),
        dict(created_at=at, delta=Decimal("-.1234")), at, "portfolio_halfhour",
    )
    assert result["status"] == "inconclusive"
    assert "source_run_write_timestamp_unavailable_daily_row_overwritten" in result["reasons"]
    assert result["fields"]["delta"] == "numeric_match"
    assert result["fields"]["implied_volatility"] == "not_in_source_contract"
