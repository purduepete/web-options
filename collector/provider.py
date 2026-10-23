from __future__ import annotations

import asyncio
from datetime import timedelta
import logging
from types import SimpleNamespace

from .config import Config
from .model import Contract, event_time, now, number
from .repository import Repository

LOG = logging.getLogger(__name__)


def quality(at, received) -> list[str]:
    if at is None:
        return ["provider_time_missing"]
    if at > received + timedelta(seconds=5):
        return ["future_provider_time"]
    return ["stale"] if received - at > timedelta(minutes=5) else []


def price_values(quote, received, underlying=None) -> dict:
    bid, ask = number(quote.bid), number(quote.ask)
    flags = quality(event_time(quote.updated_at), received)
    if bid is not None and ask is not None and bid > ask:
        flags.append("crossed")
    mid = (bid + ask) / 2 if bid is not None and ask is not None else None
    if mid is not None and mid > 0 and ask - bid > mid * number("0.20"):
        flags.append("wide_spread")
    valid = bid is not None and ask is not None and "crossed" not in flags
    return {
        "bid": bid,
        "ask": ask,
        "mark": number(quote.mark),
        "mid": mid,
        "last": number(quote.last),
        "underlying": underlying,
        "event_time": event_time(quote.updated_at),
        "summary_date": getattr(quote, "summary_date", None),
        "prev_close_date": getattr(quote, "prev_close_date", None),
        "last_trade_time": event_time(getattr(quote, "last_trade_time", None)),
        "received_at": received,
        "flags": flags,
        "status": "ok" if valid else "invalid",
        "error": None if valid else "invalid_or_missing_bid_ask",
    }


async def collect(config: Config, repo: Repository, run_id: int, contracts: list[Contract], deadline) -> None:
    from tastytrade import DXLinkStreamer, Session
    from tastytrade.dxfeed import Greeks, Quote
    from tastytrade.market_data import get_market_data_by_type

    # The SDK enables debug logging when its lazy import first runs.
    logging.getLogger("tastytrade").setLevel(logging.CRITICAL)
    groups = {}
    for contract in contracts:
        groups.setdefault(contract.broker_occ, {})[contract.key] = contract

    def wanted_contracts(missing, components):
        return [
            next(iter(owners.values())) for owners in groups.values()
            if any(components & missing.get(key, set()) for key in owners)
        ]

    def save(contract, component, values):
        missing = repo.missing(run_id)
        for key in groups[contract.broker_occ]:
            if component in missing.get(key, set()):
                repo.save(run_id, key, component, values, deadline)

    async def work() -> None:
        async with Session(config.client_secret, config.refresh_token) as session:
            # One REST retry inside the same snapshot window, then one bounded Greeks and Quote stream.
            underlying = {}
            for attempt in range(2):
                missing = repo.missing(run_id)
                wanted = wanted_contracts(missing, {"price"})
                if not wanted:
                    break
                symbols = sorted({contract.broker_underlying for contract in wanted})
                for offset in range(0, len(symbols), 100):
                    try:
                        quotes = await asyncio.wait_for(
                            get_market_data_by_type(session, equities=symbols[offset : offset + 100]), timeout=20
                        )
                        for quote in quotes:
                            price = number(quote.last_mkt)
                            underlying[quote.symbol] = price if price is not None else number(quote.mark)
                    except Exception as error:
                        # Log types only: SDK exception text can contain URLs or authentication data.
                        LOG.error("underlying batch failed: %s", type(error).__name__)
                for offset in range(0, len(wanted), 100):
                    batch = wanted[offset : offset + 100]
                    mapping = {contract.broker_occ: contract for contract in batch}
                    try:
                        quotes = await asyncio.wait_for(
                            get_market_data_by_type(session, options=list(mapping)), timeout=25
                        )
                        for quote in quotes:
                            if quote.symbol not in mapping:
                                LOG.error("provider returned an unexpected option symbol")
                                continue
                            contract = mapping[quote.symbol]
                            received = now()
                            save(
                                contract,
                                "price",
                                price_values(quote, received, underlying.get(contract.broker_underlying)),
                            )
                        returned = {quote.symbol for quote in quotes}
                        for symbol, contract in mapping.items():
                            if symbol not in returned:
                                for key in groups[contract.broker_occ]:
                                    repo.price_unavailable(run_id, key, now())
                        LOG.info(
                            "price batch %d/%d attempt=%d elapsed coverage=%d",
                            offset + len(batch),
                            len(wanted),
                            attempt + 1,
                            len(quotes),
                        )
                    except Exception as error:
                        LOG.error("option price batch failed: %s", type(error).__name__)
                        repo.component_error(run_id, "price", type(error).__name__)
                if attempt == 0:
                    await asyncio.sleep(1)

            missing = repo.missing(run_id)
            greeks = {contract.streamer_symbol: contract for contract in wanted_contracts(missing, {"delta", "iv"})}
            # REST can keep serving a crossed or absent quote; the live Quote event is the fallback.
            quoted = {contract.streamer_symbol: contract for contract in wanted_contracts(missing, {"price"})}
            if not greeks and not quoted:
                return

            def needs(contract, component):
                return any(component in missing.get(key, set()) for key in groups[contract.broker_occ])

            def store(contract, component, values):
                save(contract, component, values)
                if values["received_at"] <= deadline:
                    for key in groups[contract.broker_occ]:
                        missing.get(key, set()).discard(component)

            def pending(mapping, components):
                return any(needs(contract, component) for contract in mapping.values() for component in components)

            async def listen_greeks(streamer):
                if not greeks:
                    return
                async for event in streamer.listen(Greeks):
                    contract = greeks.get(event.event_symbol)
                    if contract is None:
                        LOG.error("unexpected Greeks symbol")
                        continue
                    received = now()
                    at = event_time(event.time)
                    for component, raw in (("delta", event.delta), ("iv", event.volatility)):
                        if not needs(contract, component):
                            continue
                        value = number(raw, delta=component == "delta")
                        if value is None:
                            continue
                        flags = quality(at, received)
                        if value == 0:
                            flags.append("zero_boundary")
                        store(contract, component, {"value": value, "event_time": at, "received_at": received, "flags": flags})
                    if not pending(greeks, ("delta", "iv")):
                        return

            async def listen_quotes(streamer):
                if not quoted:
                    return
                async for event in streamer.listen(Quote):
                    contract = quoted.get(event.event_symbol)
                    if contract is None:
                        LOG.error("unexpected Quote symbol")
                        continue
                    if not needs(contract, "price"):
                        continue
                    times = [value for value in (event.bid_time, event.ask_time) if value]
                    snapshot = SimpleNamespace(
                        bid=event.bid_price, ask=event.ask_price, mark=None, last=None,
                        updated_at=max(times) if times else None,
                    )
                    values = price_values(snapshot, now(), underlying.get(contract.broker_underlying))
                    if values["status"] != "ok":
                        continue
                    # The stream has no mark; the broker's REST mark is the bid/ask midpoint.
                    values["mark"] = values["mid"]
                    values["flags"].append("stream_quote")
                    store(contract, "price", values)
                    if not pending(quoted, ("price",)):
                        return

            async with DXLinkStreamer(session) as streamer:
                subscriptions = [(kind, list(mapping)) for kind, mapping in ((Greeks, greeks), (Quote, quoted)) if mapping]
                for kind, symbols in subscriptions:
                    for offset in range(0, len(symbols), 100):
                        await streamer.subscribe(kind, symbols[offset : offset + 100])
                try:
                    async with asyncio.timeout(min(45, max(0, (deadline - now()).total_seconds()))):
                        await asyncio.gather(listen_greeks(streamer), listen_quotes(streamer))
                except TimeoutError:
                    if pending(greeks, ("delta", "iv")):
                        LOG.error("Greeks collection timed out with missing components")
                        for component in ("delta", "iv"):
                            repo.component_error(run_id, component, "greeks_timeout")
                    if pending(quoted, ("price",)):
                        # Keep the REST price error; the audit classifies broker no-quotes from it.
                        LOG.error("Quote stream timed out with missing prices")
                finally:
                    for kind, symbols in subscriptions:
                        await streamer.unsubscribe(kind, symbols)

    remaining = (deadline - now()).total_seconds()
    if remaining <= 0:
        return
    try:
        await asyncio.wait_for(work(), timeout=min(remaining, 150))
    except Exception as error:
        LOG.error("provider capture failed: %s", type(error).__name__)
        for component in ("price", "delta", "iv"):
            repo.component_error(run_id, component, type(error).__name__)
