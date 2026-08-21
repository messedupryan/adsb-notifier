import json
import threading
from http.server import ThreadingHTTPServer
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from adsb_notifier.api import (
    ConfigApiHandler,
    DEFAULT_NOTIFICATION_CONFIG_FIELDS,
    _backup_config,
    _ensure_revision,
    _ensure_rule_ids,
    _normalize_notification_provider_selections,
    _public_config,
    _read_config,
    _restore_redacted_secrets,
    _write_config,
)
from adsb_notifier.config import load_settings_data, parse_settings, validate_settings_data
from adsb_notifier.models import Aircraft
from adsb_notifier.notifiers import DEFAULT_EMAIL_HTML_BODY_TEMPLATE, LEGACY_COMPACT_EMAIL_HTML_BODY_TEMPLATE


def valid_config() -> dict:
    return {
        "adsb_url": "http://example.test/aircraft.json",
        "home": {"lat": 40.7608, "lon": -111.8910},
        "poll_seconds": 30,
        "stale_aircraft_seconds": 90,
        "recent_matches_window_hours": 24,
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


def config_with_pushover() -> dict:
    payload = valid_config()
    payload["notifications"] = {
        "pushover": {
            "enabled": True,
            "app_token": "env:PUSHOVER_APP_TOKEN",
            "user_key": "env:PUSHOVER_USER_KEY",
        }
    }
    return payload


def config_with_enabled_notifications() -> dict:
    payload = valid_config()
    payload["notifications"] = {
        "email": {"enabled": True, "smtp_host": "smtp.example.test", "from": "from@example.test", "to": ["to@example.test"]},
        "pushover": {"enabled": True, "app_token": "env:PUSHOVER_APP_TOKEN", "user_key": "env:PUSHOVER_USER_KEY"},
        "twilio": {"enabled": False},
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


def test_read_config_backfills_rule_notification_providers(tmp_path):
    path = tmp_path / "config.json"
    payload = config_with_enabled_notifications()
    path.write_text(json.dumps(payload), encoding="utf-8")

    config = _read_config(path)

    assert config["rules"][0]["notification_providers"] == ["email", "pushover"]


def test_read_config_backfills_rule_quiet_hours(tmp_path):
    path = tmp_path / "config.json"
    payload = valid_config()
    path.write_text(json.dumps(payload), encoding="utf-8")

    config = _read_config(path)

    assert config["rules"][0]["quiet_hours"] == {
        "enabled": False,
        "start": "22:00",
        "end": "07:00",
        "time_zone": "America/Denver",
        "suppress_providers": ["pushover", "twilio"],
    }


def test_parse_settings_accepts_rule_quiet_hours():
    payload = valid_config()
    payload["rules"][0]["quiet_hours"] = {
        "enabled": True,
        "start": "21:30",
        "end": "06:15",
        "time_zone": "America/Denver",
    }

    settings = parse_settings(payload)

    assert settings.rules[0].quiet_hours.enabled is True
    assert settings.rules[0].quiet_hours.start == "21:30"
    assert settings.rules[0].quiet_hours.end == "06:15"
    assert settings.rules[0].quiet_hours.time_zone == "America/Denver"
    assert settings.rules[0].quiet_hours.suppress_providers == {"pushover", "twilio"}


def test_config_validation_rejects_invalid_quiet_hours():
    payload = valid_config()
    payload["rules"][0]["quiet_hours"] = {"enabled": True, "start": "9:00", "end": "09:00"}

    with pytest.raises(ValueError, match="quiet_hours.start must use HH:MM time"):
        parse_settings(payload)


def test_quiet_hours_reject_email_suppression():
    payload = valid_config()
    payload["rules"][0]["quiet_hours"] = {"enabled": True, "start": "22:00", "end": "07:00", "suppress_providers": ["email"]}

    with pytest.raises(ValueError, match="unsupported quiet-hours notification provider: email"):
        parse_settings(payload)


def test_quiet_hours_reject_unknown_timezone():
    payload = valid_config()
    payload["rules"][0]["quiet_hours"] = {"enabled": True, "start": "22:00", "end": "07:00", "time_zone": "Mars/Base"}

    with pytest.raises(ValueError, match="quiet_hours.time_zone is not recognized"):
        parse_settings(payload)


def test_read_config_backfills_new_notification_defaults(tmp_path):
    path = tmp_path / "config.json"
    payload = config_with_email()
    path.write_text(json.dumps(payload), encoding="utf-8")

    config = _read_config(path)

    assert config["notifications"]["email"]["html_enabled"] is False
    assert config["notifications"]["email"]["brand_theme"] == "teal"
    assert config["notifications"]["email"]["include_brand_images"] is True
    assert config["notifications"]["email"]["include_map_snapshot"] is False
    assert config["notifications"]["email"]["html_body_template"] == DEFAULT_NOTIFICATION_CONFIG_FIELDS["email"]["html_body_template"]
    assert json.loads(path.read_text(encoding="utf-8"))["notifications"]["email"]["html_enabled"] is False


def test_read_config_preserves_existing_notification_defaults(tmp_path):
    path = tmp_path / "config.json"
    payload = config_with_email()
    payload["notifications"]["email"]["html_enabled"] = True
    payload["notifications"]["email"]["brand_theme"] = "amber"
    payload["notifications"]["email"]["include_brand_images"] = False
    payload["notifications"]["email"]["include_map_snapshot"] = True
    payload["notifications"]["email"]["html_body_template"] = "<p>custom</p>"
    path.write_text(json.dumps(payload), encoding="utf-8")

    config = _read_config(path)

    assert config["notifications"]["email"]["html_enabled"] is True
    assert config["notifications"]["email"]["brand_theme"] == "amber"
    assert config["notifications"]["email"]["include_brand_images"] is False
    assert config["notifications"]["email"]["include_map_snapshot"] is True
    assert config["notifications"]["email"]["html_body_template"] == "<p>custom</p>"


def test_read_config_reformats_legacy_default_email_html_template(tmp_path):
    path = tmp_path / "config.json"
    payload = config_with_email()
    payload["notifications"]["email"]["html_body_template"] = LEGACY_COMPACT_EMAIL_HTML_BODY_TEMPLATE
    path.write_text(json.dumps(payload), encoding="utf-8")

    config = _read_config(path)

    assert config["notifications"]["email"]["html_body_template"] == DEFAULT_EMAIL_HTML_BODY_TEMPLATE
    assert "{map_snapshot_html}" in config["notifications"]["email"]["html_body_template"]
    assert "\n  <tr>\n" in config["notifications"]["email"]["html_body_template"]


def test_disabled_global_provider_is_pruned_from_rules():
    payload = config_with_enabled_notifications()
    payload["rules"][0]["notification_providers"] = ["email", "pushover", "twilio", "webhook"]
    payload["notifications"]["pushover"]["enabled"] = False

    config = _normalize_notification_provider_selections(payload)

    assert config["rules"][0]["notification_providers"] == ["email"]


def test_read_config_removes_removed_notification_blocks(tmp_path):
    path = tmp_path / "config.json"
    payload = config_with_enabled_notifications()
    payload["notifications"]["webhook"] = {"enabled": True, "url": "env:ALERT_WEBHOOK_URL"}
    payload["notifications"]["twitter"] = {"enabled": False}
    payload["rules"][0]["notification_providers"] = ["email", "webhook"]
    path.write_text(json.dumps(payload), encoding="utf-8")

    config = _read_config(path)

    assert "webhook" not in config["notifications"]
    assert "twitter" not in config["notifications"]
    assert config["rules"][0]["notification_providers"] == ["email"]


def test_public_config_redacts_notification_secrets():
    payload = config_with_pushover()
    payload["notifications"]["email"] = {"enabled": True, "password": "env:SMTP_PASSWORD"}
    payload["notifications"]["twilio"] = {"enabled": True, "api_key_secret": "env:TWILIO_API_KEY_SECRET"}

    public = _public_config(payload)

    assert public["notifications"]["email"]["password"] == "********"
    assert public["notifications"]["pushover"]["app_token"] == "********"
    assert public["notifications"]["pushover"]["user_key"] == "********"
    assert public["notifications"]["twilio"]["api_key_secret"] == "********"
    assert payload["notifications"]["pushover"]["app_token"] == "env:PUSHOVER_APP_TOKEN"


def test_restore_redacted_secrets_preserves_current_values():
    current = config_with_pushover()
    incoming = config_with_pushover()
    incoming["notifications"]["pushover"]["app_token"] = "********"
    incoming["notifications"]["pushover"]["user_key"] = "replacement-user-key"

    restored = _restore_redacted_secrets(incoming, current)

    assert restored["notifications"]["pushover"]["app_token"] == "env:PUSHOVER_APP_TOKEN"
    assert restored["notifications"]["pushover"]["user_key"] == "replacement-user-key"


def test_empty_rule_notification_providers_backfill_when_global_provider_is_enabled():
    payload = config_with_email()
    payload["rules"][0]["notification_providers"] = []

    config = _normalize_notification_provider_selections(payload)

    assert config["rules"][0]["notification_providers"] == ["email"]


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


def test_config_validation_requires_home_section():
    payload = valid_config()
    del payload["home"]

    with pytest.raises(ValueError, match="config requires home"):
        validate_settings_data(payload)


def test_config_validation_rejects_unknown_top_level_fields():
    payload = valid_config()
    payload["webhook_url"] = "https://example.test/hook"

    with pytest.raises(ValueError, match="unsupported top-level field: webhook_url"):
        validate_settings_data(payload)


def test_config_validation_rejects_invalid_home_coordinates():
    payload = valid_config()
    payload["home"]["lat"] = 120

    with pytest.raises(ValueError, match="config.home.lat must be between -90 and 90"):
        validate_settings_data(payload)


def test_config_validation_requires_rules_to_be_objects():
    payload = valid_config()
    payload["rules"] = ["not-a-rule"]

    with pytest.raises(ValueError, match=r"config.rules\[1\] must be a JSON object"):
        validate_settings_data(payload)


def test_config_validation_requires_tail_rule_tail_numbers():
    payload = valid_config()
    payload["rules"][0]["tail_numbers"] = []

    with pytest.raises(ValueError, match="target requires at least one tail_numbers"):
        validate_settings_data(payload)


def test_config_validation_requires_aircraft_type_selectors():
    payload = valid_config()
    payload["rules"][0] = {
        "name": "empty aircraft type",
        "event": "aircraft_type",
        "radius_miles": 25,
        "cooldown_minutes": 30,
    }

    with pytest.raises(ValueError, match="empty aircraft type requires aircraft_types or categories"):
        validate_settings_data(payload)


def test_config_validation_rejects_unknown_notification_providers():
    payload = valid_config()
    payload["notifications"] = {"webhook": {"enabled": True}}

    with pytest.raises(ValueError, match="notifications contains unsupported provider: webhook"):
        validate_settings_data(payload)


def test_recent_matches_window_defaults_to_24_hours():
    payload = valid_config()
    del payload["recent_matches_window_hours"]

    settings = parse_settings(payload)

    assert settings.recent_matches_window_hours == 24


def test_recent_matches_window_rejects_values_above_max():
    payload = valid_config()
    payload["recent_matches_window_hours"] = 169

    with pytest.raises(ValueError, match="recent_matches_window_hours cannot exceed 168"):
        parse_settings(payload)


def test_source_error_alerts_default_to_enabled():
    settings = parse_settings(valid_config())

    assert settings.source_error_alerts.enabled is True
    assert settings.source_error_alerts.failure_threshold == 3
    assert settings.source_error_alerts.cooldown_minutes == 60


def test_source_error_alerts_parse_overrides():
    payload = valid_config()
    payload["source_error_alerts"] = {"enabled": False, "failure_threshold": 5, "cooldown_minutes": 120}

    settings = parse_settings(payload)

    assert settings.source_error_alerts.enabled is False
    assert settings.source_error_alerts.failure_threshold == 5
    assert settings.source_error_alerts.cooldown_minutes == 120


def test_adsb_lol_source_config_is_supported():
    payload = valid_config()
    payload["adsb_source"] = {"provider": "adsb_lol", "query": "point", "radius_miles": 40}

    settings = parse_settings(payload)

    assert settings.adsb_source is not None
    assert settings.adsb_source.provider == "adsb_lol"
    assert settings.adsb_source.query == "point"
    assert settings.adsb_source.radius_miles == 40


def test_adsb_source_rejects_unknown_provider():
    payload = valid_config()
    payload["adsb_source"] = {"provider": "example_flights", "query": "point"}

    with pytest.raises(ValueError, match="unsupported adsb_source provider: example_flights"):
        parse_settings(payload)


def test_adsb_lookup_source_requires_value():
    payload = valid_config()
    payload["adsb_source"] = {"provider": "adsb_lol", "query": "reg"}

    with pytest.raises(ValueError, match="adsb_source query reg requires value"):
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


def test_military_rule_defaults_military_flag_true():
    payload = config_with_email()
    payload["rules"][0] = {
        "name": "mil",
        "event": "military",
        "radius_miles": 25,
        "cooldown_minutes": 30,
        "notification_providers": ["email"],
    }

    settings = parse_settings(payload)

    assert settings.rules[0].military is True


def test_military_rule_parses_include_tisb_setting():
    payload = config_with_email()
    payload["rules"][0] = {
        "name": "mil",
        "event": "military",
        "radius_miles": 25,
        "cooldown_minutes": 30,
        "include_tisb": True,
        "notification_providers": ["email"],
    }

    settings = parse_settings(payload)

    assert settings.rules[0].include_tisb is True


def test_squawk_rule_parses_codes():
    payload = config_with_email()
    payload["rules"][0] = {
        "name": "emergency squawk",
        "event": "squawk",
        "radius_miles": 25,
        "cooldown_minutes": 30,
        "squawk_codes": ["7700", 75],
        "notification_providers": ["email"],
    }

    settings = parse_settings(payload)

    assert settings.rules[0].squawk_codes == {"7700", "0075"}


def test_squawk_rule_rejects_invalid_codes():
    payload = config_with_email()
    payload["rules"][0] = {
        "name": "bad squawk",
        "event": "squawk",
        "radius_miles": 25,
        "cooldown_minutes": 30,
        "squawk_codes": ["8888"],
        "notification_providers": ["email"],
    }

    with pytest.raises(ValueError, match="invalid squawk code: 8888"):
        parse_settings(payload)


def test_squawk_rule_requires_at_least_one_code():
    payload = config_with_email()
    payload["rules"][0] = {
        "name": "empty squawk",
        "event": "squawk",
        "radius_miles": 25,
        "cooldown_minutes": 30,
        "squawk_codes": [],
        "notification_providers": ["email"],
    }

    with pytest.raises(ValueError, match="empty squawk requires at least one squawk code"):
        parse_settings(payload)


def test_unknown_rule_event_is_rejected():
    payload = config_with_email()
    payload["rules"][0]["event"] = "unknown"

    with pytest.raises(ValueError, match="unsupported rule event: unknown"):
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

    def fake_send_email(config, message, subject=None, html_message=None, inline_images=None):
        sent.append((config, message, subject, html_message, inline_images))

    monkeypatch.setattr("adsb_notifier.notifiers.send_email", fake_send_email)

    with api_server(path) as base_url:
        response = request_json(f"{base_url}/notifications/test", method="POST", payload={"provider": "email"})

    assert response == {"ok": True, "provider": "email"}
    assert sent[0][0]["smtp_host"] == "smtp.example.test"
    assert sent[0][1] == "ADS-B Notifier test notification"
    assert sent[0][2] == "ADS-B alert"


def test_status_endpoint_returns_worker_status(tmp_path):
    path = tmp_path / "config.json"
    status_path = tmp_path / "status.json"
    _write_config(path, valid_config())
    status_path.write_text(json.dumps({"status": "ok", "aircraft_count": 12}), encoding="utf-8")

    with api_server(path, status_path=status_path) as base_url:
        response = request_json(f"{base_url}/status")

    assert response == {"status": "ok", "aircraft_count": 12}


def test_status_endpoint_returns_unknown_when_missing(tmp_path):
    path = tmp_path / "config.json"
    _write_config(path, valid_config())

    with api_server(path, status_path=tmp_path / "missing-status.json") as base_url:
        response = request_json(f"{base_url}/status")

    assert response["status"] == "unknown"
    assert response["recent_matches"] == []


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

    def fake_send_email(config, message, subject=None, html_message=None, inline_images=None):
        raise RuntimeError("smtp auth failed")

    monkeypatch.setattr("adsb_notifier.notifiers.send_email", fake_send_email)

    with api_server(path) as base_url:
        with pytest.raises(HTTPError) as exc:
            request_json(f"{base_url}/notifications/test", method="POST", payload={"provider": "email"})

    assert exc.value.code == 502


def test_notification_test_endpoint_sends_pushover(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    _write_config(path, config_with_pushover())
    sent = []

    def fake_send_pushover(config, message, title=None, url=None, url_title=None):
        sent.append((config, message, title, url, url_title))

    monkeypatch.setattr("adsb_notifier.notifiers.send_pushover", fake_send_pushover)

    with api_server(path) as base_url:
        response = request_json(f"{base_url}/notifications/test", method="POST", payload={"provider": "pushover"})

    assert response == {"ok": True, "provider": "pushover"}
    assert sent[0][0]["app_token"] == "env:PUSHOVER_APP_TOKEN"
    assert sent[0][1] == "ADS-B Notifier test notification"
    assert sent[0][2] == "ADS-B alert"


def test_rule_test_endpoint_sends_when_rule_matches_live_data(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    payload = config_with_pushover()
    payload["rules"][0]["id"] = "rule-target"
    payload["rules"][0]["notification_providers"] = ["pushover"]
    _write_config(path, payload)
    sent = []

    monkeypatch.setattr(
        "adsb_notifier.api.fetch_aircraft_for_settings",
        lambda settings: [
            Aircraft(
                hex="A12345",
                registration="N12345",
                aircraft_type="C172",
                lat=40.7608,
                lon=-111.8910,
                altitude_ft=5500,
            )
        ],
    )
    monkeypatch.setattr(
        "adsb_notifier.notifiers.send_pushover",
        lambda config, message, title=None, url=None, url_title=None: sent.append((message, title, url, url_title)),
    )

    with api_server(path) as base_url:
        response = request_json(f"{base_url}/rules/rule-target/test", method="POST")

    assert response["ok"] is True
    assert response["matched"] is True
    assert response["sent_count"] == 1
    assert response["matches"][0]["aircraft_label"] == "N12345"
    assert response["matches"][0]["airplanes_live_url"] == "https://globe.airplanes.live/?icao=A12345"
    assert sent == [
        (
            "target: N12345 (C172) 0.0 mi away at 5500 ft",
            "ADS-B alert",
            "https://globe.airplanes.live/?icao=A12345",
            "Airplanes.live",
        )
    ]


def test_rule_test_endpoint_does_not_send_when_rule_has_no_live_match(tmp_path, monkeypatch):
    path = tmp_path / "config.json"
    payload = config_with_pushover()
    payload["rules"][0]["id"] = "rule-target"
    _write_config(path, payload)
    sent = []

    monkeypatch.setattr(
        "adsb_notifier.api.fetch_aircraft_for_settings",
        lambda settings: [
            Aircraft(
                hex="A99999",
                registration="N99999",
                lat=40.7608,
                lon=-111.8910,
                altitude_ft=5500,
            )
        ],
    )
    monkeypatch.setattr(
        "adsb_notifier.notifiers.send_pushover",
        lambda config, message, title=None, url=None, url_title=None: sent.append((message, title, url, url_title)),
    )

    with api_server(path) as base_url:
        response = request_json(f"{base_url}/rules/rule-target/test", method="POST")

    assert response["ok"] is True
    assert response["matched"] is False
    assert response["sent_count"] == 0
    assert response["matches"] == []
    assert sent == []


def test_pushover_enabled_requires_app_token_and_user_key():
    payload = valid_config()
    payload["notifications"] = {"pushover": {"enabled": True, "app_token": ""}}

    with pytest.raises(ValueError, match="pushover notifications require app_token, user_key"):
        parse_settings(payload)


def test_delete_last_rule_is_rejected(tmp_path):
    path = tmp_path / "config.json"
    _write_config(path, valid_config())
    rule_id = _read_config(path)["rules"][0]["id"]

    with api_server(path) as base_url:
        with pytest.raises(HTTPError) as exc:
            request_json(f"{base_url}/rules/{rule_id}", method="DELETE")

    assert exc.value.code == 400


class api_server:
    def __init__(self, config_path, backup_retention: int = 20, status_path=None):
        self.config_path = config_path
        self.backup_retention = backup_retention
        self.status_path = status_path or config_path.parent / "status.json"
        self.server = None
        self.thread = None
        self.base_url = ""

    def __enter__(self):
        ConfigApiHandler.config_path = self.config_path
        ConfigApiHandler.status_path = self.status_path
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
