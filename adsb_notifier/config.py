import json
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from adsb_notifier.constants import (
    DEFAULT_ADSB_REQUEST_TIMEOUT_SECONDS,
    DEFAULT_CIRCLING_HEADING_CHANGE_DEG,
    DEFAULT_CIRCLING_WINDOW_MINUTES,
    DEFAULT_POLL_SECONDS,
    DEFAULT_QUIET_HOURS_END,
    DEFAULT_QUIET_HOURS_START,
    DEFAULT_QUIET_HOURS_TIME_ZONE,
    DEFAULT_RECENT_MATCHES_WINDOW_HOURS,
    DEFAULT_RULE_COOLDOWN_MINUTES,
    DEFAULT_SOURCE_HEALTH_TREND_RETENTION_HOURS,
    DEFAULT_SOURCE_ERROR_ALERT_COOLDOWN_MINUTES,
    DEFAULT_SOURCE_ERROR_ALERT_FAILURE_THRESHOLD,
    DEFAULT_STALE_AIRCRAFT_SECONDS,
    MAX_RECENT_MATCHES_WINDOW_HOURS,
    MAX_SOURCE_HEALTH_TREND_RETENTION_HOURS,
)
from adsb_notifier.squawk import require_squawk_code

NOTIFICATION_PROVIDERS = {"email", "pushover", "twilio"}
PHONE_NOTIFICATION_PROVIDERS = {"pushover", "twilio"}
ADSB_SOURCE_PROVIDERS = {"direct", "airplanes_live", "adsb_lol"}
ADSB_SOURCE_QUERIES = {"point", "mil", "reg", "type", "hex"}
RULE_EVENTS = {"aircraft_type", "circling", "military", "squawk", "tail"}
CONFIG_TOP_LEVEL_KEYS = {
    "adsb_source",
    "adsb_url",
    "config_revision",
    "exclusions",
    "home",
    "notifications",
    "poll_seconds",
    "recent_matches_window_hours",
    "rules",
    "source_error_alerts",
    "source_health_trend_retention_hours",
    "stale_aircraft_seconds",
}


@dataclass(frozen=True)
class Home:
    lat: float
    lon: float


@dataclass(frozen=True)
class Notifications:
    email: dict[str, Any] | None = None
    twilio: dict[str, Any] | None = None
    pushover: dict[str, Any] | None = None


@dataclass(frozen=True)
class AdsbSource:
    provider: str
    query: str = "point"
    base_url: str | None = None
    radius_miles: float | None = None
    value: str | None = None


@dataclass(frozen=True)
class SourceErrorAlerts:
    enabled: bool = True
    failure_threshold: int = DEFAULT_SOURCE_ERROR_ALERT_FAILURE_THRESHOLD
    cooldown_minutes: int = DEFAULT_SOURCE_ERROR_ALERT_COOLDOWN_MINUTES


@dataclass(frozen=True)
class QuietHours:
    enabled: bool = False
    start: str = DEFAULT_QUIET_HOURS_START
    end: str = DEFAULT_QUIET_HOURS_END
    time_zone: str = DEFAULT_QUIET_HOURS_TIME_ZONE
    suppress_providers: set[str] = field(default_factory=lambda: set(PHONE_NOTIFICATION_PROVIDERS))


@dataclass(frozen=True)
class Exclusions:
    tail_numbers: set[str] = field(default_factory=set)
    hex_ids: set[str] = field(default_factory=set)
    callsigns: set[str] = field(default_factory=set)
    aircraft_types: set[str] = field(default_factory=set)
    categories: set[str] = field(default_factory=set)


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
    squawk_codes: set[str] = field(default_factory=set)
    military: bool | None = None
    include_tisb: bool = False
    min_altitude_ft: int | None = None
    max_altitude_ft: int | None = None
    cooldown_minutes: int = DEFAULT_RULE_COOLDOWN_MINUTES
    circling_min_heading_change_deg: float = DEFAULT_CIRCLING_HEADING_CHANGE_DEG
    circling_window_minutes: int = DEFAULT_CIRCLING_WINDOW_MINUTES
    notification_providers: set[str] | None = None
    quiet_hours: QuietHours = field(default_factory=QuietHours)
    exclusions: Exclusions = field(default_factory=Exclusions)


@dataclass(frozen=True)
class Settings:
    adsb_url: str
    adsb_source: AdsbSource | None
    home: Home
    poll_seconds: int
    stale_aircraft_seconds: int
    notifications: Notifications
    rules: list[Rule]
    exclusions: Exclusions = field(default_factory=Exclusions)
    recent_matches_window_hours: int = DEFAULT_RECENT_MATCHES_WINDOW_HOURS
    source_health_trend_retention_hours: int = DEFAULT_SOURCE_HEALTH_TREND_RETENTION_HOURS
    source_error_alerts: SourceErrorAlerts = field(default_factory=SourceErrorAlerts)


def load_settings(path: str | Path) -> Settings:
    data = load_settings_data(path)
    return parse_settings(data)


def load_settings_data(path: str | Path) -> dict[str, Any]:
    location = str(path)
    if location.startswith(("http://", "https://")):
        request = Request(location, headers={"User-Agent": "adsb-notifier/0.1"})
        with urlopen(request, timeout=DEFAULT_ADSB_REQUEST_TIMEOUT_SECONDS) as response:
            return json.loads(response.read().decode("utf-8"))
    return json.loads(Path(path).read_text(encoding="utf-8"))


def parse_settings(data: dict[str, Any]) -> Settings:
    validate_settings_data(data)
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
        poll_seconds=int(data.get("poll_seconds", DEFAULT_POLL_SECONDS)),
        stale_aircraft_seconds=int(data.get("stale_aircraft_seconds", DEFAULT_STALE_AIRCRAFT_SECONDS)),
        recent_matches_window_hours=_recent_matches_window_hours(data),
        source_health_trend_retention_hours=_source_health_trend_retention_hours(data),
        source_error_alerts=_parse_source_error_alerts(data.get("source_error_alerts")),
        notifications=Notifications(
            email=notification_data.get("email"),
            twilio=notification_data.get("twilio"),
            pushover=notification_data.get("pushover"),
        ),
        exclusions=_parse_exclusions(data.get("exclusions")),
        rules=rules,
    )


def validate_settings_data(data: dict[str, Any]) -> None:
    if not isinstance(data, dict):
        raise ValueError("config must be a JSON object")

    unknown_keys = sorted(set(data) - CONFIG_TOP_LEVEL_KEYS)
    if unknown_keys:
        raise ValueError(f"config contains unsupported top-level field: {', '.join(unknown_keys)}")

    _validate_required_section(data, "home", dict)
    _validate_required_section(data, "rules", list)
    _validate_optional_section(data, "adsb_source", dict)
    _validate_optional_section(data, "exclusions", dict)
    _validate_optional_section(data, "notifications", dict)
    _validate_optional_section(data, "source_error_alerts", dict)
    _validate_home_shape(data["home"])
    _validate_optional_numeric_field(data, "poll_seconds")
    _validate_optional_numeric_field(data, "stale_aircraft_seconds")
    _validate_optional_numeric_field(data, "recent_matches_window_hours")
    _validate_optional_numeric_field(data, "source_health_trend_retention_hours")
    _validate_rules_shape(data["rules"])
    _validate_exclusions_shape(data.get("exclusions"), "config.exclusions")
    _validate_notifications_shape(data.get("notifications", {}))


def _validate_required_section(data: dict[str, Any], key: str, expected_type: type) -> None:
    if key not in data:
        raise ValueError(f"config requires {key}")
    _validate_section_type(data[key], key, expected_type)


def _validate_optional_section(data: dict[str, Any], key: str, expected_type: type) -> None:
    if key in data and data[key] is not None:
        _validate_section_type(data[key], key, expected_type)


def _validate_section_type(value: Any, key: str, expected_type: type) -> None:
    if not isinstance(value, expected_type):
        type_name = "array" if expected_type is list else "object"
        raise ValueError(f"config.{key} must be a JSON {type_name}")


def _validate_home_shape(data: dict[str, Any]) -> None:
    _validate_numeric_field(data, "lat", prefix="config.home")
    _validate_numeric_field(data, "lon", prefix="config.home")
    lat = float(data["lat"])
    lon = float(data["lon"])
    if not -90 <= lat <= 90:
        raise ValueError("config.home.lat must be between -90 and 90")
    if not -180 <= lon <= 180:
        raise ValueError("config.home.lon must be between -180 and 180")


def _validate_rules_shape(rules: list[Any]) -> None:
    for index, rule in enumerate(rules, start=1):
        if not isinstance(rule, dict):
            raise ValueError(f"config.rules[{index}] must be a JSON object")
        rule_label = _rule_label(rule, index)
        if not str(rule.get("name", "")).strip():
            raise ValueError(f"{rule_label} requires name")
        event = str(rule.get("event", "")).strip()
        if not event:
            raise ValueError(f"{rule_label} requires event")
        if event == "tail":
            _validate_nonempty_list(rule, "tail_numbers", rule_label)
        if event == "aircraft_type" and not _has_list_values(rule, "aircraft_types") and not _has_list_values(rule, "categories"):
            raise ValueError(f"{rule_label} requires aircraft_types or categories")
        if "notification_providers" in rule and not isinstance(rule["notification_providers"], list):
            raise ValueError(f"{rule_label} notification_providers must be an array")
        _validate_quiet_hours_shape(rule, rule_label)
        _validate_exclusions_shape(rule.get("exclusions"), f"{rule_label} exclusions")
        _validate_numeric_field(rule, "radius_miles", prefix=rule_label)
        _validate_numeric_field(rule, "cooldown_minutes", prefix=rule_label)


def _validate_notifications_shape(notifications: dict[str, Any]) -> None:
    unknown_providers = sorted(set(notifications) - NOTIFICATION_PROVIDERS)
    if unknown_providers:
        raise ValueError(f"notifications contains unsupported provider: {', '.join(unknown_providers)}")
    for provider, provider_config in notifications.items():
        if not isinstance(provider_config, dict):
            raise ValueError(f"notifications.{provider} must be a JSON object")


def _validate_nonempty_list(data: dict[str, Any], key: str, label: str) -> None:
    if not _has_list_values(data, key):
        raise ValueError(f"{label} requires at least one {key}")


def _has_list_values(data: dict[str, Any], key: str) -> bool:
    value = data.get(key)
    return isinstance(value, list) and any(str(item).strip() for item in value)


def _validate_exclusions_shape(data: Any, label: str) -> None:
    if data is None:
        return
    if not isinstance(data, dict):
        raise ValueError(f"{label} must be a JSON object")
    unknown_keys = sorted(set(data) - {"tail_numbers", "hex_ids", "callsigns", "aircraft_types", "categories"})
    if unknown_keys:
        raise ValueError(f"{label} contains unsupported field: {', '.join(unknown_keys)}")
    for key in ("tail_numbers", "hex_ids", "callsigns", "aircraft_types", "categories"):
        if key in data and not isinstance(data[key], list):
            raise ValueError(f"{label}.{key} must be an array")


def _validate_numeric_field(data: dict[str, Any], key: str, prefix: str = "config") -> None:
    if key not in data or data[key] in (None, ""):
        raise ValueError(f"{prefix} requires {key}")
    try:
        float(data[key])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{prefix} requires numeric {key}") from exc


def _validate_optional_numeric_field(data: dict[str, Any], key: str, prefix: str = "config") -> None:
    if key not in data:
        return
    _validate_numeric_field(data, key, prefix)


def _validate_quiet_hours_shape(rule: dict[str, Any], rule_label: str) -> None:
    if "quiet_hours" not in rule or rule["quiet_hours"] is None:
        return
    quiet_hours = rule["quiet_hours"]
    if not isinstance(quiet_hours, dict):
        raise ValueError(f"{rule_label} quiet_hours must be a JSON object")
    for key in ("start", "end"):
        if key in quiet_hours and not _is_hhmm_time(quiet_hours[key]):
            raise ValueError(f"{rule_label} quiet_hours.{key} must use HH:MM time")
    if quiet_hours.get("start") == quiet_hours.get("end") and quiet_hours.get("start") is not None:
        raise ValueError(f"{rule_label} quiet_hours start and end must differ")
    if "time_zone" in quiet_hours:
        _validate_time_zone(quiet_hours["time_zone"], rule_label)
    if "suppress_providers" in quiet_hours and not isinstance(quiet_hours["suppress_providers"], list):
        raise ValueError(f"{rule_label} quiet_hours.suppress_providers must be an array")


def _is_hhmm_time(value: Any) -> bool:
    if not isinstance(value, str):
        return False
    parts = value.split(":")
    if len(parts) != 2 or not all(part.isdigit() for part in parts):
        return False
    hour = int(parts[0])
    minute = int(parts[1])
    return len(parts[0]) == 2 and len(parts[1]) == 2 and 0 <= hour <= 23 and 0 <= minute <= 59


def _validate_time_zone(value: Any, rule_label: str) -> None:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{rule_label} quiet_hours.time_zone is required")
    try:
        ZoneInfo(value.strip())
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"{rule_label} quiet_hours.time_zone is not recognized") from exc


def _rule_label(rule: dict[str, Any], index: int) -> str:
    name = str(rule.get("name", "")).strip()
    return name or f"rule {index}"


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


def _source_health_trend_retention_hours(data: dict[str, Any]) -> int:
    value = data.get("source_health_trend_retention_hours", DEFAULT_SOURCE_HEALTH_TREND_RETENTION_HOURS)
    try:
        hours = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError("source_health_trend_retention_hours must be numeric") from exc
    if hours < 1:
        raise ValueError("source_health_trend_retention_hours must be at least 1")
    if hours > MAX_SOURCE_HEALTH_TREND_RETENTION_HOURS:
        raise ValueError(f"source_health_trend_retention_hours cannot exceed {MAX_SOURCE_HEALTH_TREND_RETENTION_HOURS}")
    return hours


def _parse_source_error_alerts(data: dict[str, Any] | None) -> SourceErrorAlerts:
    if not isinstance(data, dict):
        return SourceErrorAlerts()
    return SourceErrorAlerts(
        enabled=_bool_value(data.get("enabled", True)),
        failure_threshold=max(
            1,
            int(data.get("failure_threshold", DEFAULT_SOURCE_ERROR_ALERT_FAILURE_THRESHOLD)),
        ),
        cooldown_minutes=max(
            1,
            int(data.get("cooldown_minutes", DEFAULT_SOURCE_ERROR_ALERT_COOLDOWN_MINUTES)),
        ),
    )


def _validate_notifications(data: dict[str, Any]) -> None:
    email = data.get("email")
    if isinstance(email, dict) and email.get("enabled") and email.get("html_enabled"):
        _require_provider_fields(email, "email HTML", ["html_body_template"])
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
    if provider not in ADSB_SOURCE_PROVIDERS:
        raise ValueError(f"unsupported adsb_source provider: {provider}")
    query = str(data.get("query", "point")).strip().lower()
    if query not in ADSB_SOURCE_QUERIES:
        raise ValueError(f"unsupported adsb_source query: {query}")
    if query in {"reg", "type", "hex"} and not str(data.get("value", "")).strip():
        raise ValueError(f"adsb_source query {query} requires value")
    return AdsbSource(
        provider=provider,
        query=query,
        base_url=_optional_env_or_value(data.get("base_url")),
        radius_miles=None if data.get("radius_miles") in (None, "") else float(data["radius_miles"]),
        value=_optional_env_or_value(data.get("value")),
    )


def _parse_rule(data: dict[str, Any]) -> Rule:
    name = data.get("name", "unnamed rule")
    event = data["event"]
    if event not in RULE_EVENTS:
        raise ValueError(f"unsupported rule event: {event}")
    squawk_codes = {require_squawk_code(value) for value in data.get("squawk_codes", [])}
    if event == "squawk" and not squawk_codes:
        raise ValueError(f"{name} requires at least one squawk code")
    return Rule(
        name=data["name"],
        event=event,
        radius_miles=_required_float(data, "radius_miles", name),
        id=data.get("id"),
        enabled=_bool_value(data.get("enabled", True)),
        tail_numbers={value.upper() for value in data.get("tail_numbers", [])},
        aircraft_types={value.upper() for value in data.get("aircraft_types", [])},
        categories={value.upper() for value in data.get("categories", [])},
        squawk_codes=squawk_codes,
        military=True if event == "military" else data.get("military"),
        include_tisb=_bool_value(data.get("include_tisb", False)),
        min_altitude_ft=data.get("min_altitude_ft"),
        max_altitude_ft=data.get("max_altitude_ft"),
        cooldown_minutes=_required_int(data, "cooldown_minutes", name),
        circling_min_heading_change_deg=float(
            data.get("circling_min_heading_change_deg", DEFAULT_CIRCLING_HEADING_CHANGE_DEG)
        ),
        circling_window_minutes=int(data.get("circling_window_minutes", DEFAULT_CIRCLING_WINDOW_MINUTES)),
        notification_providers=_parse_notification_providers(data),
        quiet_hours=_parse_quiet_hours(data.get("quiet_hours")),
        exclusions=_parse_exclusions(data.get("exclusions")),
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


def _parse_quiet_hours(data: dict[str, Any] | None) -> QuietHours:
    if not isinstance(data, dict):
        return QuietHours()
    suppress_providers = {
        str(provider).strip().lower()
        for provider in data.get("suppress_providers", PHONE_NOTIFICATION_PROVIDERS)
        if str(provider).strip()
    }
    unknown = suppress_providers - PHONE_NOTIFICATION_PROVIDERS
    if unknown:
        raise ValueError(f"unsupported quiet-hours notification provider: {', '.join(sorted(unknown))}")
    return QuietHours(
        enabled=_bool_value(data.get("enabled", False)),
        start=str(data.get("start", DEFAULT_QUIET_HOURS_START)),
        end=str(data.get("end", DEFAULT_QUIET_HOURS_END)),
        time_zone=str(data.get("time_zone", DEFAULT_QUIET_HOURS_TIME_ZONE)).strip(),
        suppress_providers=suppress_providers,
    )


def _parse_exclusions(data: dict[str, Any] | None) -> Exclusions:
    if not isinstance(data, dict):
        return Exclusions()
    return Exclusions(
        tail_numbers=_uppercase_values(data.get("tail_numbers", [])),
        hex_ids={_normalize_hex_id(value) for value in data.get("hex_ids", []) if str(value).strip()},
        callsigns=_uppercase_values(data.get("callsigns", [])),
        aircraft_types=_uppercase_values(data.get("aircraft_types", [])),
        categories=_uppercase_values(data.get("categories", [])),
    )


def _uppercase_values(values: list[Any]) -> set[str]:
    return {str(value).strip().upper() for value in values if str(value).strip()}


def _normalize_hex_id(value: Any) -> str:
    return str(value).strip().upper().removeprefix("~")


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
