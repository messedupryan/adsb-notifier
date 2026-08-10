from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen

NOTIFICATION_PROVIDERS = {"email", "pushover", "twilio", "webhook"}
DEFAULT_RECENT_MATCHES_WINDOW_HOURS = 24
MAX_RECENT_MATCHES_WINDOW_HOURS = 168


@dataclass(frozen=True)
class Home:
    lat: float
    lon: float


@dataclass(frozen=True)
class Notifications:
    email: dict[str, Any] | None = None
    twilio: dict[str, Any] | None = None
    pushover: dict[str, Any] | None = None
    webhook: dict[str, Any] | None = None
    twitter: dict[str, Any] | None = None


@dataclass(frozen=True)
class AdsbSource:
    provider: str
    query: str = "point"
    base_url: str | None = None
    radius_miles: float | None = None
    value: str | None = None


@dataclass(frozen=True)
class Rule:
    name: str
    event: str
    radius_miles: float
    id: str | None = None
    enabled: bool = True
    tail_numbers: set[str] = field(default_factory=set)
    aircraft_types: set[str] = field(default_factory=set)
    categories: set[str] = field(default_factory=set)
    military: bool | None = None
    include_tisb: bool = False
    min_altitude_ft: int | None = None
    max_altitude_ft: int | None = None
    cooldown_minutes: int = 30
    circling_min_heading_change_deg: float = 270.0
    circling_window_minutes: int = 8
    notification_providers: set[str] | None = None


@dataclass(frozen=True)
class Settings:
    adsb_url: str
    adsb_source: AdsbSource | None
    home: Home
    poll_seconds: int
    stale_aircraft_seconds: int
    notifications: Notifications
    rules: list[Rule]
    recent_matches_window_hours: int = DEFAULT_RECENT_MATCHES_WINDOW_HOURS


def load_settings(path: str | Path) -> Settings:
    data = load_settings_data(path)
    return parse_settings(data)


def load_settings_data(path: str | Path) -> dict[str, Any]:
    location = str(path)
    if location.startswith(("http://", "https://")):
        request = Request(location, headers={"User-Agent": "adsb-notifier/0.1"})
        with urlopen(request, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    return json.loads(Path(path).read_text(encoding="utf-8"))


def parse_settings(data: dict[str, Any]) -> Settings:
    home_data = data["home"]
    notification_data = data.get("notifications", {})
    _validate_notifications(notification_data)
    _validate_unique_rule_names(data.get("rules", []))
    rules = [_parse_rule(item) for item in data.get("rules", [])]
    if not rules:
        raise ValueError("config must include at least one rule")

    return Settings(
        adsb_url=_env_or_value(data.get("adsb_url", "")),
        adsb_source=_parse_adsb_source(data.get("adsb_source")),
        home=Home(lat=float(home_data["lat"]), lon=float(home_data["lon"])),
        poll_seconds=int(data.get("poll_seconds", 30)),
        stale_aircraft_seconds=int(data.get("stale_aircraft_seconds", 90)),
        recent_matches_window_hours=_recent_matches_window_hours(data),
        notifications=Notifications(
            email=notification_data.get("email"),
            twilio=notification_data.get("twilio"),
            pushover=notification_data.get("pushover"),
            webhook=notification_data.get("webhook"),
            twitter=notification_data.get("twitter"),
        ),
        rules=rules,
    )


def _recent_matches_window_hours(data: dict[str, Any]) -> int:
    value = data.get("recent_matches_window_hours", DEFAULT_RECENT_MATCHES_WINDOW_HOURS)
    try:
        hours = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("recent_matches_window_hours must be numeric") from exc
    if hours < 1:
        raise ValueError("recent_matches_window_hours must be at least 1")
    if hours > MAX_RECENT_MATCHES_WINDOW_HOURS:
        raise ValueError(f"recent_matches_window_hours cannot exceed {MAX_RECENT_MATCHES_WINDOW_HOURS}")
    return hours


def _validate_notifications(data: dict[str, Any]) -> None:
    pushover = data.get("pushover")
    if isinstance(pushover, dict) and pushover.get("enabled"):
        _require_provider_fields(pushover, "pushover", ["app_token", "user_key"])


def _require_provider_fields(config: dict[str, Any], provider: str, required_fields: list[str]) -> None:
    missing = [field for field in required_fields if config.get(field) in (None, "")]
    if missing:
        raise ValueError(f"{provider} notifications require {', '.join(missing)} when enabled")


def _parse_adsb_source(data: dict[str, Any] | None) -> AdsbSource | None:
    if not data:
        return None
    provider = str(data.get("provider", "")).strip().lower()
    if not provider:
        raise ValueError("adsb_source requires provider")
    return AdsbSource(
        provider=provider,
        query=str(data.get("query", "point")).strip().lower(),
        base_url=_optional_env_or_value(data.get("base_url")),
        radius_miles=None if data.get("radius_miles") in (None, "") else float(data["radius_miles"]),
        value=_optional_env_or_value(data.get("value")),
    )


def _parse_rule(data: dict[str, Any]) -> Rule:
    name = data.get("name", "unnamed rule")
    event = data["event"]
    return Rule(
        name=data["name"],
        event=event,
        radius_miles=_required_float(data, "radius_miles", name),
        id=data.get("id"),
        enabled=_bool_value(data.get("enabled", True)),
        tail_numbers={value.upper() for value in data.get("tail_numbers", [])},
        aircraft_types={value.upper() for value in data.get("aircraft_types", [])},
        categories={value.upper() for value in data.get("categories", [])},
        military=True if event == "military" else data.get("military"),
        include_tisb=_bool_value(data.get("include_tisb", False)),
        min_altitude_ft=data.get("min_altitude_ft"),
        max_altitude_ft=data.get("max_altitude_ft"),
        cooldown_minutes=_required_int(data, "cooldown_minutes", name),
        circling_min_heading_change_deg=float(data.get("circling_min_heading_change_deg", 270.0)),
        circling_window_minutes=int(data.get("circling_window_minutes", 8)),
        notification_providers=_parse_notification_providers(data),
    )


def _parse_notification_providers(data: dict[str, Any]) -> set[str] | None:
    if "notification_providers" not in data:
        return None
    providers = {
        str(provider).strip().lower()
        for provider in data.get("notification_providers", [])
        if str(provider).strip()
    }
    unknown = providers - NOTIFICATION_PROVIDERS
    if unknown:
        raise ValueError(f"unsupported notification provider: {', '.join(sorted(unknown))}")
    return providers


def _validate_unique_rule_names(rules: list[dict[str, Any]]) -> None:
    seen: set[str] = set()
    for rule in rules:
        name = str(rule.get("name", "")).strip()
        if not name:
            continue
        normalized = name.lower()
        if normalized in seen:
            raise ValueError(f"rule names must be unique: {name}")
        seen.add(normalized)


def _bool_value(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() not in {"false", "0", "no", "off"}
    return bool(value)


def _required_float(data: dict[str, Any], key: str, rule_name: str) -> float:
    value = data.get(key)
    if value in (None, ""):
        raise ValueError(f"{rule_name} requires {key}")
    try:
        return float(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{rule_name} requires numeric {key}") from exc


def _required_int(data: dict[str, Any], key: str, rule_name: str) -> int:
    value = data.get(key)
    if value in (None, ""):
        raise ValueError(f"{rule_name} requires {key}")
    try:
        return int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{rule_name} requires numeric {key}") from exc


def _env_or_value(value: str) -> str:
    if value.startswith("env:"):
        env_name = value.split(":", 1)[1]
        try:
            return os.environ[env_name]
        except KeyError as exc:
            raise ValueError(f"missing required environment variable: {env_name}") from exc
    return value


def _optional_env_or_value(value: str | None) -> str | None:
    return None if value is None else _env_or_value(value)
