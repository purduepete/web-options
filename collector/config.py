from __future__ import annotations

from dataclasses import dataclass
import json
from pathlib import Path


@dataclass(frozen=True)
class Config:
    postgres: str
    azure: dict[str, str]
    client_secret: str
    refresh_token: str
    enabled: bool
    notification: dict[str, str]
    notification_state_file: str | None = None


def load_config(path: str) -> Config:
    document = json.loads(Path(path).read_text(encoding="utf-8-sig"))
    required = ("postgres", "azure", "client_secret", "refresh_token")
    if any(not document.get(key) for key in required):
        raise ValueError("collector configuration is incomplete")
    if not all(document["azure"].get(key) for key in ("server", "database", "user", "password")):
        raise ValueError("Azure read-only source configuration is incomplete")
    return Config(
        document["postgres"],
        document["azure"],
        document["client_secret"],
        document["refresh_token"],
        document.get("enabled") is True,
        document.get("notification", {}),
        document.get("notification_state_file")
        or str(Path(path).resolve().parents[2] / "logs" / "collector-outage-notice"),
    )
