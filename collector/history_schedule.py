"""Read-only schedule export for the history API; no credentials or broker calls."""

from __future__ import annotations

import argparse
from datetime import date, timedelta
import json

from .model import slots


def export(first: date, last: date) -> list[dict[str, str]]:
    if not 0 <= (last - first).days < 93:
        raise ValueError("history range must contain 1 to 93 dates")
    result = []
    day = first
    while day <= last:
        result.extend(
            {
                "sessionDate": day.isoformat(),
                "captureKind": slot.kind,
                "scheduledAt": slot.instant.isoformat(),
            }
            for slot in slots(day)
        )
        day += timedelta(days=1)
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="first", type=date.fromisoformat, required=True)
    parser.add_argument("--to", dest="last", type=date.fromisoformat, required=True)
    args = parser.parse_args()
    print(json.dumps(export(args.first, args.last)))
