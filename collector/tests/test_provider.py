import asyncio
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from collector.config import Config
from collector.model import Contract
from collector.provider import collect


def test_greeks_wait_for_independent_valid_fields_without_overwriting():
    at = datetime.now(UTC)
    contract = Contract("test", "TEST", date(2026, 11, 20), Decimal("100"))
    components = {"price", "delta", "iv"}
    stored = {}
    repo = MagicMock()
    repo.missing.side_effect = lambda _: {contract.key: set(components)}

    def save(_run, _key, component, values, _deadline):
        if component in components:
            stored[component] = values
            components.remove(component)

    repo.save.side_effect = save
    option = SimpleNamespace(symbol=contract.occ, bid=1, ask=1.1, mark=1.05, last=1.02, updated_at=at)
    equity = SimpleNamespace(symbol="TEST", last_mkt=100, mark=100)

    async def quotes(_session, **kwargs):
        return [option] if "options" in kwargs else [equity]

    stream = MagicMock()
    stream.subscribe = AsyncMock()
    stream.unsubscribe = AsyncMock()

    async def events(_kind):
        yield SimpleNamespace(
            event_symbol=contract.streamer_symbol,
            time=int(at.timestamp() * 1000),
            delta=float("nan"),
            volatility=Decimal("0.25"),
        )
        yield SimpleNamespace(
            event_symbol=contract.streamer_symbol,
            time=int(at.timestamp() * 1000),
            delta=Decimal("-0.30"),
            volatility=float("nan"),
        )

    stream.listen.side_effect = events
    stream_context = MagicMock()
    stream_context.__aenter__ = AsyncMock(return_value=stream)
    stream_context.__aexit__ = AsyncMock(return_value=None)
    session_context = MagicMock()
    session_context.__aenter__ = AsyncMock(return_value=MagicMock())
    session_context.__aexit__ = AsyncMock(return_value=None)
    with (
        patch("tastytrade.Session", return_value=session_context),
        patch("tastytrade.DXLinkStreamer", return_value=stream_context),
        patch("tastytrade.market_data.get_market_data_by_type", side_effect=quotes),
        patch("collector.provider.asyncio.sleep", new_callable=AsyncMock),
    ):
        asyncio.run(collect(Config("", {}, "test", "test", True, {}), repo, 1, [contract], at + timedelta(seconds=10)))
    assert stored["delta"]["value"] == Decimal("-0.30")
    assert stored["iv"]["value"] == Decimal("0.25")
    assert stored["price"]["underlying"] == 100
    assert components == set()
    stream.unsubscribe.assert_awaited_once()
    session_context.__aexit__.assert_awaited_once()


def test_installer_requires_successful_isolation_before_activation():
    source = (Path(__file__).resolve().parents[2] / "scripts" / "Install-CollectorTasks.ps1").read_text()
    probe = source.index("-m collector.verify_database")
    assert source.index("if (-not $AdminPassFile -or -not $SecretsDirectory)") < probe
    assert probe < source.index("Register-ScheduledTask")
    assert "if ($LASTEXITCODE -ne 0) { throw" in source[probe:]
    assert source.index("Broker compatibility must be approved") < probe
