from __future__ import annotations

import json
import logging
from urllib.request import Request, urlopen

from adsb_notifier.models import Aircraft

LOGGER = logging.getLogger(__name__)


def fetch_aircraft(url: str, timeout_seconds: int = 10) -> list[Aircraft]:
    request = Request(url, headers={"User-Agent": "adsb-notifier/0.1"})
    with urlopen(request, timeout=timeout_seconds) as response:
        payload = json.loads(response.read().decode("utf-8"))
    return parse_aircraft_payload(payload)


def parse_aircraft_payload(payload: dict) -> list[Aircraft]:
    rows = payload.get("aircraft", payload if isinstance(payload, list) else [])
    aircraft: list[Aircraft] = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        normalized = _normalize_aircraft(row)
        if normalized.lat is None or normalized.lon is None:
            continue
        aircraft.append(normalized)
    return aircraft


def _normalize_aircraft(row: dict) -> Aircraft:
    flight = _clean(row.get("flight") or row.get("callsign"))
    registration = _clean(row.get("r") or row.get("registration") or row.get("tail"))
    aircraft_type = _clean(row.get("t") or row.get("type") or row.get("aircraft_type"))
    category = _clean(row.get("category"))
    altitude = row.get("alt_baro", row.get("alt_geom", row.get("altitude")))

    return Aircraft(
        hex=str(row.get("hex") or row.get("icao") or "").upper(),
        flight=flight,
        registration=registration,
        aircraft_type=aircraft_type,
        category=category,
        lat=_float_or_none(row.get("lat")),
        lon=_float_or_none(row.get("lon")),
        altitude_ft=_altitude_or_none(altitude),
        track_deg=_float_or_none(row.get("track") or row.get("heading")),
        seen_seconds=_float_or_none(row.get("seen")),
        emergency=_clean(row.get("emergency")),
        military=bool(row.get("military", False)),
        raw=row,
    )


def _clean(value: object) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip().upper()
    return cleaned or None


def _float_or_none(value: object) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        LOGGER.debug("Unable to parse float value %r", value)
        return None


def _altitude_or_none(value: object) -> int | None:
    if value in (None, "ground"):
        return None
    try:
        return int(float(value))
    except (TypeError, ValueError):
        LOGGER.debug("Unable to parse altitude value %r", value)
        return None

