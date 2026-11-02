import asyncio
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from collector.config import Config
from collector.model import Contract
from collector.provider import collect


def options_from(quotes):
    async def fetch(session, symbols):
        return await quotes(session, options=symbols)

    return fetch


@pytest.mark.parametrize("symbol", ["TEST", "BRK-B", "BRK.B", "BRKB"])
def test_greeks_wait_for_independent_valid_fields_without_overwriting(symbol):
    at = datetime.now(UTC)
    contract = Contract("test", symbol, date(2026, 11, 20), Decimal("100"))
    components = {"price", "delta", "iv"}
    stored = {}
    repo = MagicMock()
    repo.missing.side_effect = lambda _: {contract.key: set(components)}

    def save(_run, _key, component, values, _deadline):
        if component in components:
            stored[component] = values
            components.remove(component)

    repo.save.side_effect = save
    option = SimpleNamespace(symbol=contract.broker_occ, bid=1, ask=1.1, mark=1.05, last=1.02, updated_at=at)
    equity = SimpleNamespace(symbol=contract.broker_underlying, last_mkt=100, mark=100)

    async def quotes(_session, **kwargs):
        assert kwargs == (
            {"options": [contract.broker_occ]} if "options" in kwargs else {"equities": [contract.broker_underlying]}
        )
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
        patch("collector.provider.option_market_data", side_effect=options_from(quotes)),
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
    assert r"C:\ProgramData\SolutionDeploy\runtime\powershell\7\pwsh.exe" in source
    assert "Get-Command pwsh.exe" not in source


def test_union_deduplicates_price_retries_and_greeks_with_owner_fanout():
    at = datetime.now(UTC)
    contracts = [
        Contract("live", "BRK.B", date(2026, 11, 20), Decimal(400)),
        Contract("paper", "BRK-B", date(2026, 11, 20), Decimal(400)),
        Contract("signal", "BRKB", date(2026, 11, 20), Decimal(400)),
        Contract("other", "TEST", date(2026, 11, 20), Decimal(100)),
    ]
    components = {c.key: {"price", "delta", "iv"} for c in contracts}
    components["paper"].remove("delta")
    stored = {}
    repo = MagicMock()
    repo.missing.side_effect = lambda _: {key: set(value) for key, value in components.items()}

    def save(_run, key, component, values, _deadline):
        assert component in components[key]
        stored[key, component] = values
        components[key].remove(component)

    repo.save.side_effect = save
    price_requests = []

    async def quotes(_session, **kwargs):
        if "equities" in kwargs:
            assert len(kwargs["equities"]) == len(set(kwargs["equities"]))
            return []
        requested = kwargs["options"]
        price_requests.append(requested)
        assert len(requested) == len(set(requested))
        returned = [contracts[0].broker_occ] if len(price_requests) == 1 else [contracts[-1].broker_occ]
        return [SimpleNamespace(symbol=s, bid=1, ask=1.1, mark=1.05, last=1, updated_at=at) for s in returned]

    stream = MagicMock()
    stream.subscribe = AsyncMock()
    stream.unsubscribe = AsyncMock()

    async def events(_kind):
        for c in (contracts[0], contracts[-1]):
            yield SimpleNamespace(event_symbol=c.streamer_symbol, time=int(at.timestamp() * 1000),
                                  delta=Decimal("-0.25"), volatility=Decimal("0.4"))

    stream.listen.side_effect = events
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=MagicMock())
    session.__aexit__ = AsyncMock(return_value=None)
    streaming = MagicMock()
    streaming.__aenter__ = AsyncMock(return_value=stream)
    streaming.__aexit__ = AsyncMock(return_value=None)
    with (patch("tastytrade.Session", return_value=session) as factory,
          patch("tastytrade.DXLinkStreamer", return_value=streaming),
          patch("tastytrade.market_data.get_market_data_by_type", side_effect=quotes),
          patch("collector.provider.option_market_data", side_effect=options_from(quotes)),
          patch("collector.provider.asyncio.sleep", new_callable=AsyncMock)):
        asyncio.run(collect(Config("", {}, "", "", True, {}), repo, 1,
                            contracts + [contracts[0]], at + timedelta(seconds=15)))
    assert price_requests == [[contracts[0].broker_occ, contracts[-1].broker_occ], [contracts[-1].broker_occ]]
    symbols = stream.subscribe.call_args.args[1]
    assert symbols == [contracts[0].streamer_symbol, contracts[-1].streamer_symbol]
    assert len(stored) == 11
    assert not any(components.values())
    factory.assert_called_once()


def test_stream_quote_replaces_a_crossed_rest_price():
    at = datetime.now(UTC)
    contract = Contract("baba", "BABA", date(2026, 10, 23), Decimal("100"))
    components = {"price"}
    stored = {}
    repo = MagicMock()
    repo.missing.side_effect = lambda _: {contract.key: set(components)}

    def save(_run, _key, component, values, _deadline):
        stored.setdefault(component, []).append(values)
        if values["status"] == "ok":
            components.discard(component)

    repo.save.side_effect = save
    crossed = SimpleNamespace(symbol=contract.broker_occ, bid=0.18, ask=0.15, mark=0.18, last=0.13, updated_at=at)
    equity = SimpleNamespace(symbol=contract.broker_underlying, last_mkt=150, mark=150)

    async def quotes(_session, **kwargs):
        return [crossed] if "options" in kwargs else [equity]

    stream = MagicMock()
    stream.subscribe = AsyncMock()
    stream.unsubscribe = AsyncMock()
    stamp = int(at.timestamp() * 1000)

    async def events(kind):
        assert kind.__name__ == "Quote"
        yield SimpleNamespace(event_symbol=contract.streamer_symbol, bid_price=Decimal("0.18"),
                              ask_price=Decimal("0.15"), bid_time=stamp, ask_time=stamp)
        yield SimpleNamespace(event_symbol=contract.streamer_symbol, bid_price=Decimal("0.11"),
                              ask_price=Decimal("0.12"), bid_time=0, ask_time=stamp)

    stream.listen.side_effect = events
    streaming = MagicMock()
    streaming.__aenter__ = AsyncMock(return_value=stream)
    streaming.__aexit__ = AsyncMock(return_value=None)
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=MagicMock())
    session.__aexit__ = AsyncMock(return_value=None)
    with (patch("tastytrade.Session", return_value=session),
          patch("tastytrade.DXLinkStreamer", return_value=streaming),
          patch("tastytrade.market_data.get_market_data_by_type", side_effect=quotes),
          patch("collector.provider.option_market_data", side_effect=options_from(quotes)),
          patch("collector.provider.asyncio.sleep", new_callable=AsyncMock)):
        asyncio.run(collect(Config("", {}, "", "", True, {}), repo, 1, [contract], at + timedelta(seconds=30)))
    rest, live = stored["price"][:2], stored["price"][-1]
    assert [values["status"] for values in rest] == ["invalid", "invalid"]
    assert live["status"] == "ok" and "stream_quote" in live["flags"]
    assert (live["bid"], live["ask"], live["mark"], live["underlying"]) == (
        Decimal("0.11"), Decimal("0.12"), Decimal("0.115"), 150)
    assert len(stored["price"]) == 3
    assert stream.subscribe.call_args.args[0].__name__ == "Quote"
    stream.unsubscribe.assert_awaited_once()
    repo.component_error.assert_not_called()


def test_rest_greeks_fill_delta_and_iv_when_the_stream_is_down():
    at = datetime.now(UTC)
    contract = Contract("spy", "SPY", date(2026, 11, 20), Decimal("600"))
    components = {"price", "delta", "iv"}
    stored = {}
    repo = MagicMock()
    repo.missing.side_effect = lambda _: {contract.key: set(components)}

    def save(_run, _key, component, values, _deadline):
        stored[component] = values
        components.discard(component)

    repo.save.side_effect = save
    option = SimpleNamespace(symbol=contract.broker_occ, bid=1, ask=1.1, mark=1.05, last=1, updated_at=at,
                             delta=Decimal("-0.016"), volatility=Decimal("0.49"))

    async def quotes(_session, **kwargs):
        return [option] if "options" in kwargs else []

    streaming = MagicMock()
    streaming.__aenter__ = AsyncMock(side_effect=RuntimeError("502"))
    streaming.__aexit__ = AsyncMock(return_value=None)
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=MagicMock())
    session.__aexit__ = AsyncMock(return_value=None)
    with (patch("tastytrade.Session", return_value=session),
          patch("tastytrade.DXLinkStreamer", return_value=streaming),
          patch("tastytrade.market_data.get_market_data_by_type", side_effect=quotes),
          patch("collector.provider.option_market_data", side_effect=options_from(quotes)),
          patch("collector.provider.asyncio.sleep", new_callable=AsyncMock)):
        asyncio.run(collect(Config("", {}, "", "", True, {}), repo, 1, [contract], at + timedelta(seconds=30)))
    assert stored["delta"]["value"] == Decimal("-0.016") and "rest_greeks" in stored["delta"]["flags"]
    assert stored["iv"]["value"] == Decimal("0.49") and "rest_greeks" in stored["iv"]["flags"]
    assert components == set()
    reasons = {call.args[1]: call.args[2] for call in repo.component_error.call_args_list}
    assert reasons == {"price": "RuntimeError", "delta": "RuntimeError", "iv": "RuntimeError"}


@pytest.mark.parametrize("stream_mode", ["ended", "timeout"])
def test_rest_greeks_cover_retry_after_price_was_saved(stream_mode):
    at = datetime.now(UTC)
    contract = Contract("spy", "SPY", date(2026, 11, 20), Decimal("600"))
    components = {"delta", "iv"}
    stored = {}
    repo = MagicMock()
    repo.missing.side_effect = lambda _: {contract.key: set(components)}

    def save(_run, _key, component, values, _deadline):
        stored[component] = values
        components.discard(component)

    repo.save.side_effect = save
    option = SimpleNamespace(symbol=contract.broker_occ, bid=1, ask=1.1, mark=1.05, last=1, updated_at=at,
                             delta="-0.80", volatility="0.49")
    stream = MagicMock()
    stream.subscribe = AsyncMock()
    stream.unsubscribe = AsyncMock()

    async def events(_kind):
        yield SimpleNamespace(event_symbol=contract.streamer_symbol, time=int(at.timestamp() * 1000),
                              delta=Decimal("-0.30"), volatility=None)
        if stream_mode == "timeout":
            await asyncio.Event().wait()

    stream.listen.side_effect = events
    streaming = MagicMock()
    streaming.__aenter__ = AsyncMock(return_value=stream)
    streaming.__aexit__ = AsyncMock(return_value=None)
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=MagicMock())
    session.__aexit__ = AsyncMock(return_value=None)
    with (patch("tastytrade.Session", return_value=session),
          patch("tastytrade.DXLinkStreamer", return_value=streaming),
          patch("tastytrade.market_data.get_market_data_by_type", new_callable=AsyncMock) as equities,
          patch("collector.provider.option_market_data", new_callable=AsyncMock, return_value=[option]) as options,
          patch("collector.provider.asyncio.sleep", new_callable=AsyncMock)):
        deadline = datetime.now(UTC) + timedelta(seconds=1 if stream_mode == "timeout" else 10)
        asyncio.run(collect(Config("", {}, "", "", True, {}), repo, 1, [contract], deadline))
    assert stored["delta"]["value"] == Decimal("-0.30")
    assert "rest_greeks" not in stored["delta"]["flags"]
    assert stored["iv"]["value"] == Decimal("0.49")
    assert stored["iv"]["event_time"] == at
    assert "rest_greeks" in stored["iv"]["flags"]
    assert components == set()
    options.assert_awaited_once()
    equities.assert_not_awaited()
    repo.price_unavailable.assert_not_called()


def test_price_retry_keeps_valid_earlier_rest_greeks():
    at = datetime.now(UTC)
    contract = Contract("spy", "SPY", date(2026, 11, 20), Decimal("600"))
    components = {"price", "delta", "iv"}
    stored = {}
    repo = MagicMock()
    repo.missing.side_effect = lambda _: {contract.key: set(components)}

    def save(_run, _key, component, values, _deadline):
        if component == "price" and values["status"] != "ok":
            return
        stored[component] = values
        components.discard(component)

    repo.save.side_effect = save
    first = SimpleNamespace(symbol=contract.broker_occ, bid=1.2, ask=1.1, mark=1.1, last=1, updated_at=at,
                            delta="-0.35", volatility="0.4")
    second = SimpleNamespace(symbol=contract.broker_occ, bid=1, ask=1.1, mark=1.05, last=1, updated_at=at,
                             delta="not-a-number", volatility="0.5")
    streaming = MagicMock()
    streaming.__aenter__ = AsyncMock(side_effect=RuntimeError("502"))
    streaming.__aexit__ = AsyncMock(return_value=None)
    session = MagicMock()
    session.__aenter__ = AsyncMock(return_value=MagicMock())
    session.__aexit__ = AsyncMock(return_value=None)
    with (patch("tastytrade.Session", return_value=session),
          patch("tastytrade.DXLinkStreamer", return_value=streaming),
          patch("tastytrade.market_data.get_market_data_by_type", new_callable=AsyncMock, return_value=[]),
          patch("collector.provider.option_market_data", new_callable=AsyncMock, side_effect=[[first], [second]]) as options,
          patch("collector.provider.asyncio.sleep", new_callable=AsyncMock)):
        asyncio.run(collect(Config("", {}, "", "", True, {}), repo, 1, [contract], at + timedelta(seconds=10)))
    assert stored["price"]["status"] == "ok"
    assert stored["delta"]["value"] == Decimal("-0.35")
    assert stored["iv"]["value"] == Decimal("0.5")
    assert components == set()
    assert options.await_count == 2


@pytest.mark.parametrize("delta", ["-0.016322412", "", "NaN", {"unexpected": True}])
def test_option_market_data_keeps_rest_greeks(delta):
    from collector.provider import option_market_data

    session = MagicMock()
    session._get = AsyncMock(return_value={"items": [{
        "symbol": "SPY   261120P00600000", "instrument-type": "Equity Option",
        "updated-at": "2026-10-31T19:00:00Z", "bid": "1.0", "ask": "1.1", "mark": "1.05",
        "bid-size": "10", "ask-size": "12", "close-price-type": "Final", "summary-date": "2026-10-30",
        "prev-close-date": "2026-10-29", "prev-close-price-type": "Final",
        "halt-start-time": -1, "halt-end-time": -1,
        "delta": delta, "volatility": "0.490429434",
    }]})
    [quote] = asyncio.run(option_market_data(session, ["SPY   261120P00600000"]))
    session._get.assert_awaited_once_with("/market-data/by-type", params={"equity-option": ["SPY   261120P00600000"]})
    assert (quote.delta, quote.volatility, quote.bid) == (delta, "0.490429434", Decimal("1.0"))
