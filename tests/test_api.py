import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from adsb_notifier.api import (
    ConfigApiHandler,
    _backup_config,
    _ensure_revision,
    _ensure_rule_ids,
    _read_config,
    _write_config,
)
from adsb_notifier.config import load_settings_data, parse_settings


def valid_config() -> dict:
    return {
        "adsb_url": "http://example.test/aircraft.json",
        "home": {"lat": 40.7608, "lon": -111.8910},
        "poll_seconds": 30,
        "stale_aircraft_seconds": 90,
        "notifications": {},
        "rules": [
            {
                "name": "target",
                "event": "tail",
                "radius_miles": 10,
                "cooldown_minutes": 30,
                "tail_numbers": ["N12345"],
            }
        ],
    }


def config_with_email() -> dict:
    payload = valid_config()
    payload["notifications"] = {
        "email": {
            "enabled": True,
            "smtp_host": "smtp.example.test",
            "smtp_port": 587,
            "from": "adsb@example.test",
            "to": ["ops@example.test"],
        }
    }
    return payload


def test_write_config_round_trips_json(tmp_path):
    path = tmp_path / "config.json"
    payload = valid_config()

    _write_config(path, payload)

    assert json.loads(path.read_text()) == payload
    assert _read_config(path)["rules"][0]["id"].startswith("rule-")


def test_read_config_backfills_rule_ids(tmp_path):
    path = tmp_path / "config.json"
    payload = valid_config()
    path.write_text(json.dumps(payload), encoding="utf-8")

    config = _read_config(path)

    assert config["rules"][0]["id"].startswith("rule-")
    assert config["config_revision"] == 1
    assert json.loads(path.read_text())["rules"][0]["id"] == config["rules"][0]["id"]


def test_ensure_rule_ids_replaces_duplicate_ids():
    payload = valid_config()
    payload["rules"] = [
        {"id": "rule-same", "name": "one", "event": "tail", "radius_miles": 10, "cooldown_minutes": 30},
        {"id": "rule-same", "name": "two", "event": "tail", "radius_miles": 20, "cooldown_minutes": 30},
    ]

    config = _ensure_rule_ids(payload)

    ids = [rule["id"] for rule in config["rules"]]
    assert ids[0] == "rule-same"
    assert ids[1] != "rule-same"


def test_ensure_revision_defaults_missing_or_invalid_revision():
    assert _ensure_revision({})["config_revision"] == 1
    assert _ensure_revision({"config_revision": "abc"})["config_revision"] == 1
    assert _ensure_revision({"config_revision": 4})["config_revision"] == 4


def test_backup_config_writes_current_revision_snapshot(tmp_path):
    path = tmp_path / "config.json"
    payload = valid_config()
    payload["config_revision"] = 7
    _write_config(path, payload)

    backup_path = _backup_config(path)

    assert backup_path.parent == tmp_path / "backups"
    assert backup_path.name.startswith("config.rev-7.")
    assert json.loads(backup_path.read_text()) == payload


def test_backup_retention_prunes_old_snapshots(tmp_path):
    path = tmp_path / "config.json"
    payload = valid_config()

    for revision in range(1, 5):
        payload["config_revision"] = revision
        _write_config(path, payload)
        _backup_config(path, backup_retention=2)

    backups = list((tmp_path / "backups").glob("config.rev-*.json"))
    assert len(backups) == 2


def test_zero_backup_retention_disables_backups(tmp_path):
    path = tmp_path / "config.json"
    _write_config(path, valid_config())

    updated = valid_config()
    updated["home"]["lat"] = 41
    _write_config(path, updated, create_backup=True, backup_retention=0)

    assert not (tmp_path / "backups").exists()


def test_invalid_config_without_rules_is_rejected():
    payload = valid_config()
    payload["rules"] = []

    with pytest.raises(ValueError, match="at least one rule"):
        parse_settings(payload)


def test_rule_without_radius_is_rejected_with_clear_message():
    payload = valid_config()
    del payload["rules"][0]["radius_miles"]

    with pytest.raises(ValueError, match="target requires radius_miles"):
        parse_settings(payload)


def test_rule_without_cooldown_is_rejected_with_clear_message():
    payload = valid_config()
    payload["rules"][0]["cooldown_minutes"] = None

    with pytest.raises(ValueError, match="target requires cooldown_minutes"):
        parse_settings(payload)


def test_duplicate_rule_names_are_rejected():
    payload = valid_config()
    payload["rules"].append(
        {
            "name": "TARGET",
            "event": "tail",
            "radius_miles": 20,
            "cooldown_minutes": 30,
            "tail_numbers": ["N67890"],
        }
    )

    with pytest.raises(ValueError, match="rule names must be unique: TARGET"):
        parse_settings(payload)


def test_load_settings_data_supports_http(monkeypatch):
    payload = valid_config()

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def read(self):
            return json.dumps(payload).encode("utf-8")

    def fake_urlopen(request, timeout):
        assert request.full_url == "http://config.test/config"
        assert timeout == 10
        return Response()

    monkeypatch.setattr("adsb_notifier.config.urlopen", fake_urlopen)

    assert load_settings_data("http://config.test/config") == payload


def test_rule_endpoints_create_update_and_delete_rule(tmp_path):
    path = tmp_path / "config.json"
    _write_config(path, valid_config())

    with api_server(path) as base_url:
        initial = request_json(f"{base_url}/config")
        created_payload = request_json(
            f"{base_url}/rules",
            method="POST",
            headers={"If-Match": str(initial["config_revision"])},
            payload={
                "name": "temporary",
                "event": "tail",
                "radius_miles": 5,
                "cooldown_minutes": 10,
                "tail_numbers": ["NTEMP"],
            },
        )
        created = created_payload["rule"]

        assert created["id"].startswith("rule-")
        assert created["name"] == "temporary"
        assert created_payload["config_revision"] == initial["config_revision"] + 1

        updated_payload = request_json(
            f"{base_url}/rules/{created['id']}",
            method="PUT",
            headers={"If-Match": str(created_payload["config_revision"])},
            payload={
                "name": "temporary updated",
                "event": "tail",
                "radius_miles": 6,
                "cooldown_minutes": 11,
                "tail_numbers": ["NUPD"],
            },
        )
        updated = updated_payload["rule"]

        assert updated["id"] == created["id"]
        assert updated["tail_numbers"] == ["NUPD"]
        assert updated_payload["config_revision"] == created_payload["config_revision"] + 1

        deleted = request_json(
            f"{base_url}/rules/{created['id']}",
            method="DELETE",
            headers={"If-Match": str(updated_payload["config_revision"])},
        )

        assert deleted["deleted"] == created["id"]
        assert deleted["config_revision"] == updated_payload["config_revision"] + 1
        assert all(rule["id"] != created["id"] for rule in _read_config(path)["rules"])


def test_stale_revision_is_rejected(tmp_path):
    path = tmp_path / "config.json"
    _write_config(path, valid_config())

    with api_server(path) as base_url:
        current = request_json(f"{base_url}/config")
        updated = valid_config()
        updated["home"]["lat"] = 41
        request_json(
            f"{base_url}/config",
            method="PUT",
            headers={"If-Match": str(current["config_revision"])},
            payload=updated,
        )

        with pytest.raises(HTTPError) as exc:
            request_json(
                f"{base_url}/config",
                method="PUT",
                headers={"If-Match": str(current["config_revision"])},
                payload=valid_config(),
            )

    assert exc.value.code == 409


def test_config_update_creates_backup_before_overwrite(tmp_path):
    path = tmp_path / "config.json"
    _write_config(path, valid_config())

    with api_server(path) as base_url:
        current = request_json(f"{base_url}/config")
        updated = valid_config()
        updated["home"]["lat"] = 41
        saved = request_json(
            f"{base_url}/config",
            method="PUT",
            headers={"If-Match": str(current["config_revision"])},
            payload=updated,
        )

    backups = list((tmp_path / "backups").glob("config.rev-1.*.json"))
    assert saved["config_revision"] == current["config_revision"] + 1
    assert len(backups) == 1
    assert json.loads(backups[0].read_text())["home"]["lat"] == valid_config()["home"]["lat"]


def test_config_update_respects_backup_retention(tmp_path):
    path = tmp_path / "config.json"
    _write_config(path, valid_config())

    with api_server(path, backup_retention=2) as base_url:
        for index in range(4):
            current = request_json(f"{base_url}/config")
            updated = current
            updated["home"]["lat"] = 41 + index
            request_json(
                f"{base_url}/config",
                method="PUT",
                headers={"If-Match": str(current["config_revision"])},
                payload=updated,
            )

    backups = list((tmp_path / "backups").glob("config.rev-*.json"))
    assert len(backups) == 2


def test_notification_test_endpoint_sends_provider(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    _write_config(path, config_with_email())
    sent = []

    def fake_send_email(config, message):
        sent.append((config, message))

    monkeypatch.setattr("adsb_notifier.notifiers.send_email", fake_send_email)

    with api_server(path) as base_url:
        response = request_json(f"{base_url}/notifications/test", method="POST", payload={"provider": "email"})

    assert response == {"ok": True, "provider": "email"}
    assert sent[0][0]["smtp_host"] == "smtp.example.test"
    assert sent[0][1] == "ADS-B Notifier test notification"


def test_notification_test_endpoint_rejects_disabled_provider(tmp_path):
    path = tmp_path / "config.json"
    payload = config_with_email()
    payload["notifications"]["email"]["enabled"] = False
    _write_config(path, payload)

    with api_server(path) as base_url:
        with pytest.raises(HTTPError) as exc:
            request_json(f"{base_url}/notifications/test", method="POST", payload={"provider": "email"})

    assert exc.value.code == 400


def test_notification_test_endpoint_returns_error_when_send_fails(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    _write_config(path, config_with_email())

    def fake_send_email(config, message):
        raise RuntimeError("smtp auth failed")

    monkeypatch.setattr("adsb_notifier.notifiers.send_email", fake_send_email)

    with api_server(path) as base_url:
        with pytest.raises(HTTPError) as exc:
            request_json(f"{base_url}/notifications/test", method="POST", payload={"provider": "email"})

    assert exc.value.code == 502


def test_delete_last_rule_is_rejected(tmp_path):
    path = tmp_path / "config.json"
    _write_config(path, valid_config())
    rule_id = _read_config(path)["rules"][0]["id"]

    with api_server(path) as base_url:
        with pytest.raises(HTTPError) as exc:
            request_json(f"{base_url}/rules/{rule_id}", method="DELETE")

    assert exc.value.code == 400


class api_server:
    def __init__(self, config_path, backup_retention: int = 20):
        self.config_path = config_path
        self.backup_retention = backup_retention
        self.server = None
        self.thread = None
        self.base_url = ""

    def __enter__(self):
        ConfigApiHandler.config_path = self.config_path
        ConfigApiHandler.backup_retention = self.backup_retention
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), ConfigApiHandler)
        host, port = self.server.server_address
        self.base_url = f"http://{host}:{port}"
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        return self.base_url

    def __exit__(self, exc_type, exc, traceback):
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()


def request_json(url: str, method: str = "GET", payload: dict | None = None, headers: dict | None = None) -> dict:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request_headers = {"Content-Type": "application/json", **(headers or {})}
    request = Request(url, data=data, method=method, headers=request_headers)
    with urlopen(request, timeout=5) as response:
        return json.loads(response.read().decode("utf-8"))
