from __future__ import annotations

import asyncio
from datetime import timedelta
import logging

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
        "received_at": received,
        "flags": flags,
        "status": "ok" if valid else "invalid",
        "error": None if valid else "invalid_or_missing_bid_ask",
    }


async def collect(config: Config, repo: Repository, run_id: int, contracts: list[Contract], deadline) -> None:
    from tastytrade import DXLinkStreamer, Session
    from tastytrade.dxfeed import Greeks
    from tastytrade.market_data import get_market_data_by_type

    async def work() -> None:
        async with Session(config.client_secret, config.refresh_token) as session:
            # One REST retry inside the same snapshot window, then one bounded Greeks stream.
            for attempt in range(2):
                missing = repo.missing(run_id)
                wanted = [contract for contract in contracts if "price" in missing[contract.key]]
                if not wanted:
                    break
                underlying = {}
                symbols = sorted({contract.symbol for contract in wanted})
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
                    mapping = {contract.occ: contract for contract in batch}
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
                            repo.save(
                                run_id,
                                contract.key,
                                "price",
                                price_values(quote, received, underlying.get(contract.symbol)),
                                deadline,
                            )
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
            wanted = [contract for contract in contracts if {"delta", "iv"} & missing[contract.key]]
            if not wanted:
                return
            mapping = {contract.streamer_symbol: contract for contract in wanted}
            async with DXLinkStreamer(session) as streamer:
                symbols = list(mapping)
                for offset in range(0, len(symbols), 100):
                    await streamer.subscribe(Greeks, symbols[offset : offset + 100])
                try:
                    async with asyncio.timeout(min(45, max(0, (deadline - now()).total_seconds()))):
                        async for event in streamer.listen(Greeks):
                            contract = mapping.get(event.event_symbol)
                            if contract is None:
                                LOG.error("unexpected Greeks symbol")
                                continue
                            received = now()
                            at = event_time(event.time)
                            for component, raw in (("delta", event.delta), ("iv", event.volatility)):
                                if component not in missing[contract.key]:
                                    continue
                                value = number(raw, delta=component == "delta")
                                if value is None:
                                    continue
                                flags = quality(at, received)
                                if value == 0:
                                    flags.append("zero_boundary")
                                repo.save(
                                    run_id,
                                    contract.key,
                                    component,
                                    {
                                        "value": value,
                                        "event_time": at,
                                        "received_at": received,
                                        "flags": flags,
                                    },
                                    deadline,
                                )
                                if received <= deadline:
                                    missing[contract.key].discard(component)
                            if not any({"delta", "iv"} & fields for fields in missing.values()):
                                break
                except TimeoutError:
                    LOG.error("Greeks collection timed out with missing components")
                    for component in ("delta", "iv"):
                        repo.component_error(run_id, component, "greeks_timeout")
                finally:
                    await streamer.unsubscribe(Greeks, symbols)

    remaining = (deadline - now()).total_seconds()
    if remaining <= 0:
        return
    try:
        await asyncio.wait_for(work(), timeout=min(remaining, 150))
    except Exception as error:
        LOG.error("provider capture failed: %s", type(error).__name__)
        for component in ("price", "delta", "iv"):
            repo.component_error(run_id, component, type(error).__name__)
