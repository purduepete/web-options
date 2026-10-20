from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal, InvalidOperation
import re
from zoneinfo import ZoneInfo

PACIFIC = ZoneInfo("America/Los_Angeles")
EASTERN = ZoneInfo("America/New_York")
WINDOW = timedelta(minutes=5)


def now() -> datetime:
    return datetime.now(UTC)


def number(value: object, *, delta: bool = False) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        result = Decimal(str(value))
    except InvalidOperation:
        return None
    if not result.is_finite():
        return None
    if delta:
        return result if -1 <= result <= 0 else None
    return result if result >= 0 else None


def event_time(value: object) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(UTC) if value.tzinfo else None
    if isinstance(value, (int, float)) and value > 0:
        try:
            return datetime.fromtimestamp(value / 1000, UTC)
        except (ValueError, OverflowError, OSError):
            return None
    return None


@dataclass(frozen=True)
class Contract:
    key: str
    symbol: str
    expiration: date
    strike: Decimal

    @property
    def occ(self) -> str:
        if not re.fullmatch(r"[A-Z][A-Z0-9.-]{0,5}", self.symbol):
            raise ValueError("unsupported underlying symbol")
        scaled = self.strike * 1000
        if scaled != scaled.to_integral_value() or not 0 < scaled <= 99999999:
            raise ValueError("unsupported option strike")
        return f"{self.symbol:<6}{self.expiration:%y%m%d}P{int(scaled):08d}"

    @property
    def streamer_symbol(self) -> str:
        return f".{self.symbol}{self.expiration:%y%m%d}P{self.strike.normalize():f}"


@dataclass(frozen=True)
class Slot:
    kind: str
    instant: datetime
    deadline: datetime
    session: date


def session_bounds(day: date) -> tuple[datetime, datetime] | None:
    import exchange_calendars
    import pandas

    calendar = exchange_calendars.get_calendar("XNYS")
    label = pandas.Timestamp(day)
    if not calendar.is_session(label):
        return None
    return (
        calendar.session_open(label).to_pydatetime().astimezone(UTC),
        calendar.session_close(label).to_pydatetime().astimezone(UTC),
    )


def slots(day: date) -> list[Slot]:
    bounds = session_bounds(day)
    if bounds is None:
        return []
    opened, closed = bounds
    result = []
    instant = opened
    while instant < closed:
        result.append(Slot("open_session", instant, min(instant + WINDOW, closed), day))
        instant += timedelta(minutes=30)
    result.append(Slot("close", closed, closed + WINDOW, day))
    return result


def choose_slot(
    at: datetime,
    scheduled: list[Slot],
    completed: set[tuple[str, datetime]],
    active: Slot | None = None,
    heartbeat: datetime | None = None,
) -> Slot | None:
    if active is not None and at <= active.deadline:
        return active
    for slot in scheduled:
        if slot.instant <= at <= slot.deadline and (slot.kind, slot.instant) not in completed:
            return slot
    if not scheduled or not scheduled[0].instant <= at < scheduled[-1].instant:
        return None
    latest = max(slot.instant for slot in scheduled if slot.instant <= at)
    # A completed recovery after this scheduled slot already covers the interval.
    if any(kind == "recovery" and instant >= latest for kind, instant in completed):
        return None
    if any(instant == latest for _, instant in completed):
        return None
    if heartbeat is not None and at - heartbeat < timedelta(minutes=2):
        return None
    return Slot(
        "recovery", at.replace(second=0, microsecond=0), min(at + WINDOW, scheduled[-1].instant), scheduled[0].session
    )
