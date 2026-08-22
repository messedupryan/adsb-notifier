import json
import os
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from adsb_notifier.adsb import build_adsb_url
from adsb_notifier.config import Settings
from adsb_notifier.constants import MAX_RECENT_MATCHES
from adsb_notifier.links import airplanes_live_aircraft_url
from adsb_notifier.models import Sighting


def write_poll_status(path: str | Path, settings: Settings, aircraft_count: int, sightings: list[Sighting]) -> None:
    recent_matches = _recent_matches(path, settings, sightings)
    now = _now_iso()
    existing = read_status(path)
    adsb_url = build_adsb_url(settings)
    payload = {
        "status": "ok",
        "last_poll_at": now,
        "adsb_url": adsb_url,
        "aircraft_count": aircraft_count,
        "notification_count": len(sightings),
        "recent_matches_window_hours": settings.recent_matches_window_hours,
        "recent_matches": recent_matches,
        "last_error": None,
        "consecutive_source_errors": 0,
        "rate_limit_retry_at": None,
        "rate_limit_backoff_seconds": 0,
        "source_health": _source_health(
            status="healthy",
            settings=settings,
            adsb_url=adsb_url,
            last_success_at=now,
            last_failure_at=existing.get("source_health", {}).get("last_failure_at") or existing.get("last_error_at"),
            last_aircraft_count=aircraft_count,
        ),
    }
    write_status(path, payload)


def write_error_status(path: str | Path, error: BaseException) -> None:
    existing = read_status(path)
    now = _now_iso()
    consecutive_source_errors = _next_source_error_count(existing)
    existing.update(
        {
            "status": "error",
            "last_error": str(error),
            "last_error_at": now,
            "consecutive_source_errors": consecutive_source_errors,
            "source_health": _source_health(
                status="failing",
                existing=existing,
                last_failure_at=now,
                last_error=str(error),
                consecutive_source_errors=consecutive_source_errors,
            ),
        }
    )
    write_status(path, existing)


def write_rate_limit_status(
    path: str | Path,
    settings: Settings,
    error: BaseException,
    backoff_seconds: int,
) -> None:
    existing = read_status(path)
    now = datetime.now(timezone.utc)
    status = _source_error_status(error)
    retry_at = (now + timedelta(seconds=backoff_seconds)).isoformat()
    adsb_url = build_adsb_url(settings)
    consecutive_source_errors = _next_source_error_count(existing)
    existing.update(
        {
            "status": status,
            "adsb_url": adsb_url,
            "last_error": str(error),
            "last_error_at": now.isoformat(),
            "consecutive_source_errors": consecutive_source_errors,
            "rate_limit_backoff_seconds": backoff_seconds,
            "rate_limit_retry_at": retry_at,
            "source_health": _source_health(
                status=status,
                settings=settings,
                adsb_url=adsb_url,
                existing=existing,
                last_failure_at=now.isoformat(),
                retry_at=retry_at,
                backoff_seconds=backoff_seconds,
                last_error=str(error),
                consecutive_source_errors=consecutive_source_errors,
            ),
        }
    )
    write_status(path, existing)


def _source_health(
    *,
    status: str,
    settings: Settings | None = None,
    adsb_url: str | None = None,
    existing: dict[str, Any] | None = None,
    last_success_at: str | None = None,
    last_failure_at: str | None = None,
    retry_at: str | None = None,
    backoff_seconds: int = 0,
    last_aircraft_count: int | None = None,
    last_error: str | None = None,
    consecutive_source_errors: int = 0,
) -> dict[str, Any]:
    previous = existing.get("source_health", {}) if isinstance(existing, dict) else {}
    return {
        "status": status,
        "provider": _source_provider(settings) if settings else previous.get("provider") or "unknown",
        "query": _source_query(settings) if settings else previous.get("query") or "",
        "url": adsb_url or previous.get("url") or (existing or {}).get("adsb_url") or "",
        "last_success_at": last_success_at or previous.get("last_success_at") or (existing or {}).get("last_poll_at"),
        "last_failure_at": last_failure_at or previous.get("last_failure_at") or (existing or {}).get("last_error_at"),
        "retry_at": retry_at,
        "backoff_seconds": backoff_seconds,
        "last_aircraft_count": last_aircraft_count if last_aircraft_count is not None else previous.get("last_aircraft_count") or (existing or {}).get("aircraft_count"),
        "last_error": last_error,
        "consecutive_source_errors": consecutive_source_errors,
    }


def _source_provider(settings: Settings) -> str:
    if settings.adsb_source is None:
        return "direct"
    return settings.adsb_source.provider


def _source_query(settings: Settings) -> str:
    if settings.adsb_source is None:
        return "aircraft_json"
    return settings.adsb_source.query


def _source_error_status(error: BaseException) -> str:
    match getattr(error, "status_code", None):
        case 403:
            return "access_denied"
        case 429:
            return "rate_limited"
        case _:
            return "source_unavailable"


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


def _next_source_error_count(status: dict[str, Any]) -> int:
    try:
        return int(status.get("consecutive_source_errors") or 0) + 1
    except (TypeError, ValueError):
        return 1


def _sighting_summary(sighting: Sighting) -> dict[str, Any]:
    plane = sighting.aircraft
    return {
        "rule_name": sighting.rule_name,
        "event_type": sighting.event_type,
        "aircraft_label": plane.label,
        "registration": plane.registration,
        "flight": plane.flight,
        "hex": plane.hex,
        "airplanes_live_url": airplanes_live_aircraft_url(plane.hex),
        "adsb_exchange_url": airplanes_live_aircraft_url(plane.hex),
        "aircraft_type": plane.aircraft_type or plane.category,
        "category": plane.category,
        "source_type": plane.source_type,
        "is_tisb": plane.is_tisb,
        "lat": plane.lat,
        "lon": plane.lon,
        "distance_miles": round(sighting.distance_miles, 2),
        "altitude_ft": plane.altitude_ft,
        "track_deg": plane.track_deg,
        "ground_speed_kt": _first_present(plane.raw, "gs", "speed", "ground_speed", "ground_speed_kt"),
        "vertical_rate_fpm": _first_present(plane.raw, "baro_rate", "geom_rate", "vertical_rate", "vertical_rate_fpm"),
        "squawk": plane.squawk,
        "notification_providers": sorted(sighting.notification_providers or []),
        "suppressed_notification_providers": sorted(sighting.suppressed_notification_providers),
        "notification_status": _notification_status(sighting),
        "observed_at": sighting.observed_at.isoformat(),
        "aircraft_payload": _aircraft_payload(plane),
    }


def _aircraft_payload(plane: Any) -> dict[str, Any]:
    return {
        "hex": plane.hex,
        "flight": plane.flight,
        "registration": plane.registration,
        "aircraft_type": plane.aircraft_type,
        "category": plane.category,
        "source_type": plane.source_type,
        "lat": plane.lat,
        "lon": plane.lon,
        "altitude_ft": plane.altitude_ft,
        "track_deg": plane.track_deg,
        "ground_speed_kt": _first_present(plane.raw, "gs", "speed", "ground_speed", "ground_speed_kt"),
        "vertical_rate_fpm": _first_present(plane.raw, "baro_rate", "geom_rate", "vertical_rate", "vertical_rate_fpm"),
        "seen_seconds": plane.seen_seconds,
        "squawk": plane.squawk,
        "emergency": plane.emergency,
        "military": plane.military,
        "is_tisb": plane.is_tisb,
        "raw": plane.raw,
    }


def _first_present(values: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in values and values[key] not in (None, ""):
            return values[key]
    return None


def _notification_status(sighting: Sighting) -> str:
    if not sighting.suppressed_notification_providers:
        return "sent"
    if sighting.notification_providers:
        return "partially_suppressed"
    return "suppressed"


def _recent_matches(path: str | Path, settings: Settings, sightings: list[Sighting]) -> list[dict[str, Any]]:
    now = datetime.now(timezone.utc)
    cutoff = now - timedelta(hours=settings.recent_matches_window_hours)
    current = [_sighting_summary(sighting) for sighting in sightings]
    existing = read_status(path).get("recent_matches", [])
    if not isinstance(existing, list):
        existing = []

    merged: list[dict[str, Any]] = []
    seen: set[tuple[Any, ...]] = set()
    for match in [*current, *existing]:
        if not isinstance(match, dict) or not _match_is_recent(match, cutoff):
            continue
        match = _backfill_match_links(match)
        # Status history is append-only between polls, so this stable key prevents
        # re-saving the same live match while still allowing repeat alerts later.
        key = (
            match.get("observed_at"),
            match.get("rule_name"),
            match.get("hex"),
            match.get("aircraft_label"),
        )
        if key in seen:
            continue
        seen.add(key)
        merged.append(match)

    merged.sort(key=lambda match: _observed_at(match) or datetime.min.replace(tzinfo=timezone.utc), reverse=True)
    return merged[:MAX_RECENT_MATCHES]


def _match_is_recent(match: dict[str, Any], cutoff: datetime) -> bool:
    observed_at = _observed_at(match)
    return observed_at is not None and observed_at >= cutoff


def _backfill_match_links(match: dict[str, Any]) -> dict[str, Any]:
    url = airplanes_live_aircraft_url(match.get("hex"))
    if match.get("airplanes_live_url"):
        if match["airplanes_live_url"] != url:
            return {**match, "airplanes_live_url": url, "adsb_exchange_url": url}
        if match.get("adsb_exchange_url") != url:
            return {**match, "adsb_exchange_url": url}
        return match
    return {**match, "airplanes_live_url": url, "adsb_exchange_url": url}


def _observed_at(match: dict[str, Any]) -> datetime | None:
    value = match.get("observed_at")
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
