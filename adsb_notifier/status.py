from __future__ import annotations

import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from adsb_notifier.adsb import build_adsb_url
from adsb_notifier.config import Settings
from adsb_notifier.models import Sighting


def write_poll_status(path: str | Path, settings: Settings, aircraft_count: int, sightings: list[Sighting]) -> None:
    payload = {
        "status": "ok",
        "last_poll_at": _now_iso(),
        "adsb_url": build_adsb_url(settings),
        "aircraft_count": aircraft_count,
        "notification_count": len(sightings),
        "recent_matches": [_sighting_summary(sighting) for sighting in sightings[:20]],
        "last_error": None,
    }
    write_status(path, payload)


def write_error_status(path: str | Path, error: BaseException) -> None:
    existing = read_status(path)
    existing.update(
        {
            "status": "error",
            "last_error": str(error),
            "last_error_at": _now_iso(),
        }
    )
    write_status(path, existing)


def read_status(path: str | Path) -> dict[str, Any]:
    status_path = Path(path)
    if not status_path.exists():
        return {"status": "unknown", "last_error": None, "recent_matches": []}
    return json.loads(status_path.read_text(encoding="utf-8"))


def write_status(path: str | Path, payload: dict[str, Any]) -> None:
    status_path = Path(path)
    status_path.parent.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=status_path.parent, delete=False) as temp_file:
        temp_file.write(serialized)
        temp_name = temp_file.name
    os.replace(temp_name, status_path)


def _sighting_summary(sighting: Sighting) -> dict[str, Any]:
    plane = sighting.aircraft
    return {
        "rule_name": sighting.rule_name,
        "event_type": sighting.event_type,
        "aircraft_label": plane.label,
        "registration": plane.registration,
        "flight": plane.flight,
        "hex": plane.hex,
        "aircraft_type": plane.aircraft_type or plane.category,
        "distance_miles": round(sighting.distance_miles, 2),
        "altitude_ft": plane.altitude_ft,
        "notification_providers": sorted(sighting.notification_providers or []),
        "observed_at": sighting.observed_at.isoformat(),
    }


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
