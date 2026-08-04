from __future__ import annotations

import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen


@dataclass(frozen=True)
class Home:
    lat: float
    lon: float


@dataclass(frozen=True)
class Notifications:
    email: dict[str, Any] | None = None
    twilio: dict[str, Any] | None = None
    webhook: dict[str, Any] | None = None
    twitter: dict[str, Any] | None = None


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
    min_altitude_ft: int | None = None
    max_altitude_ft: int | None = None
    cooldown_minutes: int = 30
    circling_min_heading_change_deg: float = 270.0
    circling_window_minutes: int = 8


@dataclass(frozen=True)
class Settings:
    adsb_url: str
    home: Home
    poll_seconds: int
    stale_aircraft_seconds: int
    notifications: Notifications
    rules: list[Rule]


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
    _validate_unique_rule_names(data.get("rules", []))
    rules = [_parse_rule(item) for item in data.get("rules", [])]
    if not rules:
        raise ValueError("config must include at least one rule")

    return Settings(
        adsb_url=_env_or_value(data["adsb_url"]),
        home=Home(lat=float(home_data["lat"]), lon=float(home_data["lon"])),
        poll_seconds=int(data.get("poll_seconds", 30)),
        stale_aircraft_seconds=int(data.get("stale_aircraft_seconds", 90)),
        notifications=Notifications(
            email=notification_data.get("email"),
            twilio=notification_data.get("twilio"),
            webhook=notification_data.get("webhook"),
            twitter=notification_data.get("twitter"),
        ),
        rules=rules,
    )


def _parse_rule(data: dict[str, Any]) -> Rule:
    name = data.get("name", "unnamed rule")
    return Rule(
        name=data["name"],
        event=data["event"],
        radius_miles=_required_float(data, "radius_miles", name),
        id=data.get("id"),
        enabled=_bool_value(data.get("enabled", True)),
        tail_numbers={value.upper() for value in data.get("tail_numbers", [])},
        aircraft_types={value.upper() for value in data.get("aircraft_types", [])},
        categories={value.upper() for value in data.get("categories", [])},
        military=data.get("military"),
        min_altitude_ft=data.get("min_altitude_ft"),
        max_altitude_ft=data.get("max_altitude_ft"),
        cooldown_minutes=_required_int(data, "cooldown_minutes", name),
        circling_min_heading_change_deg=float(data.get("circling_min_heading_change_deg", 270.0)),
        circling_window_minutes=int(data.get("circling_window_minutes", 8)),
    )


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
