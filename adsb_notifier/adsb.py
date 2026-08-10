from __future__ import annotations

import json
import logging
import math
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from urllib.error import HTTPError
from urllib.parse import quote
from urllib.request import Request, urlopen

from adsb_notifier.config import Settings
from adsb_notifier.models import Aircraft

LOGGER = logging.getLogger(__name__)


class AdsbRateLimitError(RuntimeError):
    def __init__(self, url: str, retry_after_seconds: int | None = None):
        super().__init__("ADS-B source rate limit reached")
        self.url = url
        self.retry_after_seconds = retry_after_seconds


def fetch_aircraft(url: str, timeout_seconds: int = 10) -> list[Aircraft]:
    request = Request(url, headers={"User-Agent": "adsb-notifier/0.1"})
    try:
        with urlopen(request, timeout=timeout_seconds) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as exc:
        if exc.code == 429:
            raise AdsbRateLimitError(url, _retry_after_seconds(exc.headers.get("Retry-After"))) from exc
        raise
    return parse_aircraft_payload(payload)


def fetch_aircraft_for_settings(settings: Settings, timeout_seconds: int = 10) -> list[Aircraft]:
    return fetch_aircraft(build_adsb_url(settings), timeout_seconds=timeout_seconds)


def build_adsb_url(settings: Settings) -> str:
    source = settings.adsb_source
    if source is None or source.provider == "direct":
        if not settings.adsb_url:
            raise ValueError("adsb_url is required when adsb_source is not configured")
        return settings.adsb_url

    base_url = _source_base_url(source.provider, source.base_url).rstrip("/")
    if source.query == "point":
        radius = source.radius_miles or _max_enabled_rule_radius(settings)
        radius = min(radius, 250)
        return f"{base_url}/point/{settings.home.lat}/{settings.home.lon}/{radius:g}"
    if source.query in {"reg", "type", "hex"}:
        if not source.value:
            raise ValueError(f"adsb_source query {source.query} requires value")
        return f"{base_url}/{source.query}/{quote(source.value.strip())}"
    if source.query == "mil":
        return f"{base_url}/mil"
    raise ValueError(f"unsupported adsb_source query: {source.query}")


def parse_aircraft_payload(payload: dict) -> list[Aircraft]:
    rows = payload.get("aircraft") or payload.get("ac") or (payload if isinstance(payload, list) else [])
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
    altitude = row.get("alt_baro", row.get("alt_geom", row.get("altitude", row.get("alt"))))

    return Aircraft(
        hex=str(row.get("hex") or row.get("icao") or "").upper(),
        flight=flight,
        registration=registration,
        aircraft_type=aircraft_type,
        category=category,
        source_type=_clean_lower(row.get("type")),
        lat=_float_or_none(row.get("lat")),
        lon=_float_or_none(row.get("lon")),
        altitude_ft=_altitude_or_none(altitude),
        track_deg=_float_or_none(row.get("track") or row.get("heading")),
        seen_seconds=_float_or_none(row.get("seen")),
        emergency=_clean(row.get("emergency")),
        military=_military_flag(row),
        raw=row,
    )


def _source_base_url(provider: str, configured_base_url: str | None = None) -> str:
    if configured_base_url:
        return configured_base_url
    if provider == "airplanes_live":
        return "https://api.airplanes.live/v2"
    if provider == "adsb_lol":
        return "https://api.adsb.lol/v2"
    raise ValueError(f"unsupported adsb_source provider: {provider}")


def _retry_after_seconds(value: str | None) -> int | None:
    if not value:
        return None
    try:
        return max(1, int(float(value)))
    except ValueError:
        pass

    try:
        retry_at = parsedate_to_datetime(value)
    except (TypeError, ValueError):
        LOGGER.debug("Unable to parse Retry-After value %r", value)
        return None
    if retry_at.tzinfo is None:
        retry_at = retry_at.replace(tzinfo=timezone.utc)
    return max(1, math.ceil((retry_at - datetime.now(timezone.utc)).total_seconds()))


def _max_enabled_rule_radius(settings: Settings) -> float:
    radii = [rule.radius_miles for rule in settings.rules if rule.enabled]
    return max(radii) if radii else 25.0


def _bool_or_false(value: object) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "y"}
    return bool(value)


def _military_flag(row: dict) -> bool:
    if _bool_or_false(row.get("military", row.get("mil"))):
        return True
    try:
        # readsb/Airplanes.live expose military registration metadata in bit 0 of dbFlags.
        return bool(int(row.get("dbFlags", 0)) & 1)
    except (TypeError, ValueError):
        return False


def _clean(value: object) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip().upper()
    return cleaned or None


def _clean_lower(value: object) -> str | None:
    if value is None:
        return None
    cleaned = str(value).strip().lower()
    return cleaned or None


def _float_or_none(value: object) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        LOGGER.debug("Unable to parse float value %r", value)
        return None


def _altitude_or_none(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, str) and value.strip().lower() == "ground":
        # Ground traffic arrives as a string in common aircraft.json feeds.
        return 0
    try:
        return int(float(value))
    except (TypeError, ValueError):
        LOGGER.debug("Unable to parse altitude value %r", value)
        return None
