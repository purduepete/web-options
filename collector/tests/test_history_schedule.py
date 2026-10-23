from datetime import date, datetime, UTC
from unittest.mock import patch

import pytest

from collector.history_schedule import export
from collector.model import Slot


def test_schedule_uses_collector_slots():
    instant = datetime(2026, 10, 23, 13, 35, tzinfo=UTC)
    slot = Slot("open_session", instant, instant, date(2026, 10, 23))
    with patch("collector.history_schedule.slots", return_value=[slot]) as schedule:
        result = export(date(2026, 10, 23), date(2026, 10, 23))
    assert schedule.call_count == 1
    assert result[0]["scheduledAt"] == instant.isoformat()


@pytest.mark.parametrize("first,last", [
    (date(2026, 10, 23), date(2026, 10, 22)),
    (date(2026, 1, 1), date(2026, 12, 31)),
])
def test_schedule_rejects_unbounded_ranges(first, last):
    with pytest.raises(ValueError):
        export(first, last)
