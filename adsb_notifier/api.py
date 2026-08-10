from __future__ import annotations

import argparse
import json
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from adsb_notifier.adsb import fetch_aircraft_for_settings
from adsb_notifier.config import NOTIFICATION_PROVIDERS, parse_settings
from adsb_notifier.links import adsb_exchange_aircraft_url
from adsb_notifier.notifiers import NotificationFanout, send_test_notification
from adsb_notifier.rules import RuleEngine
from adsb_notifier.status import read_status

LOGGER = logging.getLogger(__name__)


class ConfigApiHandler(BaseHTTPRequestHandler):
    config_path: Path
    status_path: Path
    backup_retention: int = 20

    def do_GET(self) -> None:
        route = _route(self.path)
        if route == ["healthz"]:
            self._send_json({"ok": True})
            return
        if route == ["config"]:
            self._send_json(_read_config(self.config_path))
            return
        if route == ["status"]:
            self._send_json(read_status(self.status_path))
            return
        if route == ["rules"]:
            config = _read_config(self.config_path)
            config = _ensure_rule_ids(config)
            _write_config(self.config_path, config)
            self._send_json({"rules": config.get("rules", [])})
            return
        self._send_error(HTTPStatus.NOT_FOUND, "not found")

    def do_POST(self) -> None:
        route = _route(self.path)
        if route == ["notifications", "test"]:
            self._test_notification()
            return
        if len(route) == 3 and route[0] == "rules" and route[2] == "test":
            self._test_rule(route[1])
            return
        if route != ["rules"]:
            self._send_error(HTTPStatus.NOT_FOUND, "not found")
            return

        try:
            rule = self._read_json_body()
            config = _ensure_rule_ids(_read_config(self.config_path))
            _check_revision(self.headers.get("If-Match"), config)
            rule = _ensure_rule_id(rule)
            rule = _normalize_rule_notification_providers(rule, config)
            config.setdefault("rules", []).append(rule)
            config = _normalize_notification_provider_selections(config)
            parse_settings(config)
            config = _bump_revision(config)
            _write_config(self.config_path, config, create_backup=True, backup_retention=self.backup_retention)
        except json.JSONDecodeError:
            LOGGER.warning("rule create rejected: request body must be valid JSON")
            self._send_error(HTTPStatus.BAD_REQUEST, "request body must be valid JSON")
            return
        except RevisionConflict as exc:
            LOGGER.warning("rule create rejected: %s", exc)
            self._send_error(HTTPStatus.CONFLICT, str(exc))
            return
        except (KeyError, TypeError, ValueError) as exc:
            LOGGER.warning("rule create rejected: %s", exc)
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return

        self._send_json({"rule": rule, "config_revision": config["config_revision"]}, status=HTTPStatus.CREATED)

    def _test_notification(self) -> None:
        try:
            payload = self._read_json_body()
            provider = str(payload.get("provider", "")).strip()
            settings = parse_settings(_read_config(self.config_path))
            send_test_notification(settings.notifications, provider)
        except json.JSONDecodeError:
            LOGGER.warning("notification test rejected: request body must be valid JSON")
            self._send_error(HTTPStatus.BAD_REQUEST, "request body must be valid JSON")
            return
        except (KeyError, TypeError, ValueError) as exc:
            LOGGER.warning("notification test rejected: %s", exc)
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except Exception as exc:
            LOGGER.exception("notification test failed")
            self._send_error(HTTPStatus.BAD_GATEWAY, f"notification send failed: {exc}")
            return

        self._send_json({"ok": True, "provider": provider})

    def _test_rule(self, rule_id: str) -> None:
        try:
            config = _read_config(self.config_path)
            rule = _find_rule(config, rule_id)
            test_config = dict(config)
            test_config["rules"] = [rule]
            settings = parse_settings(test_config)
            aircraft = fetch_aircraft_for_settings(settings)
            sightings = RuleEngine(settings).evaluate(aircraft)
            fanout = NotificationFanout(settings.notifications)
            for sighting in sightings:
                fanout.send(sighting)
        except KeyError:
            self._send_error(HTTPStatus.NOT_FOUND, "rule not found")
            return
        except (TypeError, ValueError) as exc:
            LOGGER.warning("rule test rejected: %s", exc)
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return
        except Exception as exc:
            LOGGER.exception("rule test failed")
            self._send_error(HTTPStatus.BAD_GATEWAY, f"rule test failed: {exc}")
            return

        self._send_json(
            {
                "ok": True,
                "rule": rule,
                "matched": bool(sightings),
                "match_count": len(sightings),
                "sent_count": len(sightings),
                "matches": [_sighting_summary(sighting) for sighting in sightings],
            }
        )

    def do_PUT(self) -> None:
        route = _route(self.path)
        if route == ["config"]:
            self._replace_config()
            return
        if len(route) == 2 and route[0] == "rules":
            self._replace_rule(route[1])
            return
        self._send_error(HTTPStatus.NOT_FOUND, "not found")

    def do_DELETE(self) -> None:
        route = _route(self.path)
        if len(route) != 2 or route[0] != "rules":
            self._send_error(HTTPStatus.NOT_FOUND, "not found")
            return

        config = _ensure_rule_ids(_read_config(self.config_path))
        rules = config.get("rules", [])
        next_rules = [rule for rule in rules if rule.get("id") != route[1]]
        if len(next_rules) == len(rules):
            self._send_error(HTTPStatus.NOT_FOUND, "rule not found")
            return
        if not next_rules:
            self._send_error(HTTPStatus.BAD_REQUEST, "config must include at least one rule")
            return
        config["rules"] = next_rules
        try:
            _check_revision(self.headers.get("If-Match"), config)
            parse_settings(config)
            config = _bump_revision(config)
            _write_config(self.config_path, config, create_backup=True, backup_retention=self.backup_retention)
        except RevisionConflict as exc:
            LOGGER.warning("rule delete rejected: %s", exc)
            self._send_error(HTTPStatus.CONFLICT, str(exc))
            return
        except (KeyError, TypeError, ValueError) as exc:
            LOGGER.warning("rule delete rejected: %s", exc)
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return

        self._send_json({"deleted": route[1], "rules": next_rules, "config_revision": config["config_revision"]})

    def _replace_config(self) -> None:
        try:
            payload = _ensure_rule_ids(self._read_json_body())
            current = _read_config(self.config_path)
            _check_revision(self.headers.get("If-Match"), current)
            payload = _normalize_notification_provider_selections(payload)
            parse_settings(payload)
            payload = _bump_revision(payload, current)
            _write_config(self.config_path, payload, create_backup=True, backup_retention=self.backup_retention)
        except json.JSONDecodeError:
            LOGGER.warning("config update rejected: request body must be valid JSON")
            self._send_error(HTTPStatus.BAD_REQUEST, "request body must be valid JSON")
            return
        except RevisionConflict as exc:
            LOGGER.warning("config update rejected: %s", exc)
            self._send_error(HTTPStatus.CONFLICT, str(exc))
            return
        except (KeyError, TypeError, ValueError) as exc:
            LOGGER.warning("config update rejected: %s", exc)
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return

        self._send_json(_read_config(self.config_path))

    def _replace_rule(self, rule_id: str) -> None:
        try:
            rule = self._read_json_body()
            rule["id"] = rule_id
            config = _ensure_rule_ids(_read_config(self.config_path))
            _check_revision(self.headers.get("If-Match"), config)
            rules = config.get("rules", [])
            for index, existing_rule in enumerate(rules):
                if existing_rule.get("id") == rule_id:
                    rules[index] = _normalize_rule_notification_providers(rule, config)
                    break
            else:
                self._send_error(HTTPStatus.NOT_FOUND, "rule not found")
                return
            parse_settings(config)
            config = _bump_revision(config)
            _write_config(self.config_path, config, create_backup=True, backup_retention=self.backup_retention)
        except json.JSONDecodeError:
            LOGGER.warning("rule update rejected: request body must be valid JSON")
            self._send_error(HTTPStatus.BAD_REQUEST, "request body must be valid JSON")
            return
        except RevisionConflict as exc:
            LOGGER.warning("rule update rejected: %s", exc)
            self._send_error(HTTPStatus.CONFLICT, str(exc))
            return
        except (KeyError, TypeError, ValueError) as exc:
            LOGGER.warning("rule update rejected: %s", exc)
            self._send_error(HTTPStatus.BAD_REQUEST, str(exc))
            return

        self._send_json({"rule": rule, "config_revision": config["config_revision"]})

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self._send_common_headers()
        self.end_headers()

    def log_message(self, format: str, *args: Any) -> None:
        LOGGER.info("%s - %s", self.address_string(), format % args)

    def _read_json_body(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        raw_body = self.rfile.read(length)
        payload = json.loads(raw_body.decode("utf-8"))
        if not isinstance(payload, dict):
            raise ValueError("request body must be a JSON object")
        return payload

    def _send_json(self, payload: dict[str, Any], status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
        self.send_response(status)
        self._send_common_headers()
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _send_error(self, status: HTTPStatus, message: str) -> None:
        self._send_json({"error": message}, status=status)

    def _send_common_headers(self) -> None:
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, If-Match")
        self.send_header("Cache-Control", "no-store")


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage ADS-B notifier configuration.")
    parser.add_argument("--config", default="/config/config.json", help="Path to JSON config file.")
    parser.add_argument(
        "--status-file",
        default=os.environ.get("ADSB_STATUS_FILE", "status.json"),
        help="Path to worker status JSON file served by GET /status.",
    )
    parser.add_argument("--host", default="0.0.0.0", help="Host interface to bind.")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind.")
    parser.add_argument(
        "--backup-retention",
        type=int,
        default=int(os.environ.get("ADSB_CONFIG_BACKUP_RETENTION", "20")),
        help="Number of config backups to retain. Use 0 to disable backups.",
    )
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    config_path = Path(args.config)
    config_path.parent.mkdir(parents=True, exist_ok=True)
    if not config_path.exists():
        _write_config(config_path, _default_config())

    ConfigApiHandler.config_path = config_path
    ConfigApiHandler.status_path = Path(args.status_file)
    ConfigApiHandler.backup_retention = max(0, args.backup_retention)
    server = ThreadingHTTPServer((args.host, args.port), ConfigApiHandler)
    LOGGER.info(
        "config API listening on %s:%s config=%s backup_retention=%s",
        args.host,
        args.port,
        config_path,
        ConfigApiHandler.backup_retention,
    )
    server.serve_forever()


def _read_config(path: Path) -> dict[str, Any]:
    config = json.loads(path.read_text(encoding="utf-8"))
    normalized = _normalize_notification_provider_selections(_ensure_revision(_ensure_rule_ids(config)))
    if normalized != config:
        _write_config(path, normalized)
    return normalized


def _write_config(path: Path, payload: dict[str, Any], create_backup: bool = False, backup_retention: int = 20) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if create_backup and path.exists() and backup_retention > 0:
        _backup_config(path, backup_retention=backup_retention)
    serialized = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temp_file:
        temp_file.write(serialized)
        temp_name = temp_file.name
    os.replace(temp_name, path)


def _backup_config(path: Path, backup_retention: int = 20) -> Path:
    backup_dir = path.parent / "backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    current = json.loads(path.read_text(encoding="utf-8"))
    revision = current.get("config_revision", "unknown")
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup_path = backup_dir / f"{path.stem}.rev-{revision}.{timestamp}.{uuid.uuid4().hex[:8]}{path.suffix}"
    backup_path.write_text(json.dumps(current, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    _prune_config_backups(path, backup_retention)
    return backup_path


def _prune_config_backups(path: Path, backup_retention: int) -> None:
    if backup_retention < 0:
        return
    backup_dir = path.parent / "backups"
    if not backup_dir.exists():
        return

    backups = sorted(
        backup_dir.glob(f"{path.stem}.rev-*{path.suffix}"),
        key=lambda item: (item.stat().st_mtime_ns, item.name),
        reverse=True,
    )
    for backup in backups[backup_retention:]:
        backup.unlink()


def _route(path: str) -> list[str]:
    return [part for part in urlparse(path).path.split("/") if part]


def _ensure_rule_ids(config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(config)
    seen: set[str] = set()
    normalized_rules = []
    for rule in normalized.get("rules", []):
        next_rule = _ensure_rule_id(rule, seen)
        seen.add(next_rule["id"])
        normalized_rules.append(next_rule)
    normalized["rules"] = normalized_rules
    return normalized


def _ensure_rule_id(rule: dict[str, Any], seen: set[str] | None = None) -> dict[str, Any]:
    next_rule = dict(rule)
    rule_id = str(next_rule.get("id") or "")
    if not rule_id or (seen is not None and rule_id in seen):
        rule_id = f"rule-{uuid.uuid4().hex[:12]}"
    next_rule["id"] = rule_id
    return next_rule


def _find_rule(config: dict[str, Any], rule_id: str) -> dict[str, Any]:
    for rule in config.get("rules", []):
        if rule.get("id") == rule_id:
            return rule
    raise KeyError(rule_id)


def _sighting_summary(sighting: Any) -> dict[str, Any]:
    plane = sighting.aircraft
    return {
        "rule_name": sighting.rule_name,
        "event_type": sighting.event_type,
        "aircraft_label": plane.label,
        "registration": plane.registration,
        "flight": plane.flight,
        "hex": plane.hex,
        "adsb_exchange_url": adsb_exchange_aircraft_url(plane.hex),
        "aircraft_type": plane.aircraft_type or plane.category,
        "distance_miles": round(sighting.distance_miles, 2),
        "altitude_ft": plane.altitude_ft,
        "notification_providers": sorted(sighting.notification_providers or []),
    }


def _normalize_notification_provider_selections(config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(config)
    normalized["rules"] = [
        _normalize_rule_notification_providers(rule, normalized)
        for rule in normalized.get("rules", [])
    ]
    return normalized


def _normalize_rule_notification_providers(rule: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    next_rule = dict(rule)
    enabled = _enabled_notification_providers(config)
    if "notification_providers" in next_rule:
        selected = {
            str(provider).strip().lower()
            for provider in next_rule.get("notification_providers", [])
            if str(provider).strip()
        }
        if not selected:
            next_rule["notification_providers"] = sorted(enabled)
            return next_rule
        next_rule["notification_providers"] = sorted((selected & NOTIFICATION_PROVIDERS) & enabled)
        return next_rule
    next_rule["notification_providers"] = sorted(enabled)
    return next_rule


def _enabled_notification_providers(config: dict[str, Any]) -> set[str]:
    notifications = config.get("notifications", {})
    return {
        provider
        for provider in NOTIFICATION_PROVIDERS
        if isinstance(notifications.get(provider), dict) and notifications[provider].get("enabled", True)
    }


class RevisionConflict(ValueError):
    pass


def _ensure_revision(config: dict[str, Any]) -> dict[str, Any]:
    normalized = dict(config)
    try:
        revision = int(normalized.get("config_revision", 1))
    except (TypeError, ValueError):
        revision = 1
    normalized["config_revision"] = max(1, revision)
    return normalized


def _check_revision(expected_revision: str | None, current_config: dict[str, Any]) -> None:
    if expected_revision in (None, ""):
        return
    try:
        expected = int(expected_revision)
    except ValueError as exc:
        raise ValueError("If-Match must be a numeric config revision") from exc

    current = int(current_config.get("config_revision", 1))
    if expected != current:
        raise RevisionConflict(f"config revision conflict: expected {expected}, current {current}")


def _bump_revision(config: dict[str, Any], current_config: dict[str, Any] | None = None) -> dict[str, Any]:
    next_config = dict(config)
    base = current_config if current_config is not None else config
    next_config["config_revision"] = int(base.get("config_revision", 1)) + 1
    return next_config


def _default_config() -> dict[str, Any]:
    return {
        "config_revision": 1,
        "adsb_url": "http://readsb.default.svc.cluster.local/tar1090/data/aircraft.json",
        "home": {"lat": 40.7608, "lon": -111.8910},
        "poll_seconds": 30,
        "stale_aircraft_seconds": 90,
        "recent_matches_window_hours": 24,
        "notifications": {},
        "rules": [
            {
                "name": "example-tail",
                "event": "tail",
                "enabled": True,
                "radius_miles": 25,
                "tail_numbers": ["N12345"],
                "cooldown_minutes": 30,
            }
        ],
    }


if __name__ == "__main__":
    main()
