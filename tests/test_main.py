import json
from datetime import datetime, timedelta, timezone

from adsb_notifier.config import AdsbSource, Home, Notifications, Settings, SourceErrorAlerts
from adsb_notifier.main import (
    MAX_RATE_LIMIT_BACKOFF_SECONDS,
    SourceFailureState,
    _apply_overrides,
    _maybe_send_source_error_alert,
    _rate_limit_backoff_seconds,
    _source_error_log_label,
)
from adsb_notifier.adsb import AdsbAccessDeniedError, AdsbRateLimitError, AdsbSourceUnavailableError
from adsb_notifier.models import Aircraft, Sighting
from adsb_notifier.status import read_status, write_error_status, write_poll_status, write_rate_limit_status


def test_apply_overrides_replaces_adsb_url_only():
    settings = Settings(
        adsb_url="http://cluster/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
    )

    updated = _apply_overrides(settings, "http://127.0.0.1:8080/data/aircraft.json")

    assert updated.adsb_url == "http://127.0.0.1:8080/data/aircraft.json"
    assert updated.home == settings.home
    assert updated.notifications == settings.notifications


def test_write_poll_status_records_worker_summary(tmp_path):
    settings = Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
    )
    sighting = Sighting(
        aircraft=Aircraft(
            hex="ABC123",
            registration="N12345",
            aircraft_type="C172",
            source_type="adsb_icao",
            lat=40.77,
            lon=-111.9,
            track_deg=183,
            raw={"gs": 122, "baro_rate": -320},
        ),
        distance_miles=4.2,
        rule_name="target",
        event_type="tail",
        notification_providers={"pushover"},
        suppressed_notification_providers={"twilio"},
    )
    status_path = tmp_path / "status.json"

    write_poll_status(status_path, settings, aircraft_count=12, sightings=[sighting])

    status = read_status(status_path)
    assert status["status"] == "ok"
    assert status["aircraft_count"] == 12
    assert status["notification_count"] == 1
    assert status["recent_matches"][0]["aircraft_label"] == "N12345"
    assert status["recent_matches"][0]["lat"] == 40.77
    assert status["recent_matches"][0]["lon"] == -111.9
    assert status["recent_matches"][0]["track_deg"] == 183
    assert status["recent_matches"][0]["ground_speed_kt"] == 122
    assert status["recent_matches"][0]["vertical_rate_fpm"] == -320
    assert status["recent_matches"][0]["source_type"] == "adsb_icao"
    assert status["recent_matches"][0]["aircraft_payload"]["registration"] == "N12345"
    assert status["recent_matches"][0]["aircraft_payload"]["raw"] == {"baro_rate": -320, "gs": 122}
    assert status["recent_matches"][0]["airplanes_live_url"] == "https://globe.airplanes.live/?icao=ABC123"
    assert status["recent_matches"][0]["notification_status"] == "partially_suppressed"
    assert status["recent_matches"][0]["suppressed_notification_providers"] == ["twilio"]
    assert status["recent_matches_window_hours"] == 24
    assert status["source_health_trend_retention_hours"] == 168
    assert status["source_health"]["status"] == "healthy"
    assert status["source_health"]["provider"] == "direct"
    assert status["source_health"]["query"] == "aircraft_json"
    assert status["source_health"]["last_success_at"] == status["last_poll_at"]
    assert status["source_health"]["last_aircraft_count"] == 12
    assert status["source_health_trends"][0]["event_type"] == "success"
    assert status["source_health_trends"][0]["aircraft_count"] == 12
    assert status["source_health_trends"][0]["provider"] == "direct"


def test_write_poll_status_preserves_recent_match_history(tmp_path):
    settings = Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
        recent_matches_window_hours=12,
    )
    old_recent = {
        "rule_name": "old-but-recent",
        "event_type": "tail",
        "aircraft_label": "NOLD",
        "hex": "ABC123",
        "adsb_exchange_url": "https://globe.adsbexchange.com/?icao=ABC123",
        "observed_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
    }
    too_old = {
        "rule_name": "too-old",
        "event_type": "tail",
        "aircraft_label": "NTOOOLD",
        "hex": "DEF456",
        "observed_at": (datetime.now(timezone.utc) - timedelta(hours=13)).isoformat(),
    }
    status_path = tmp_path / "status.json"
    status_path.write_text(json.dumps({"recent_matches": [old_recent, too_old]}), encoding="utf-8")
    sighting = Sighting(
        aircraft=Aircraft(hex="FRESH", registration="NFRESH"),
        distance_miles=2.5,
        rule_name="fresh",
        event_type="tail",
    )

    write_poll_status(status_path, settings, aircraft_count=3, sightings=[sighting])

    status = read_status(status_path)
    labels = [match["aircraft_label"] for match in status["recent_matches"]]
    assert labels == ["NFRESH", "NOLD"]
    assert status["recent_matches"][1]["airplanes_live_url"] == "https://globe.airplanes.live/?icao=ABC123"
    assert status["recent_matches"][1]["adsb_exchange_url"] == "https://globe.airplanes.live/?icao=ABC123"


def test_write_error_status_preserves_previous_poll_summary(tmp_path):
    status_path = tmp_path / "status.json"
    status_path.write_text('{"aircraft_count": 12, "recent_matches": []}', encoding="utf-8")

    write_error_status(status_path, RuntimeError("provider failed"))

    status = read_status(status_path)
    assert status["status"] == "error"
    assert status["aircraft_count"] == 12
    assert status["last_error"] == "provider failed"
    assert status["consecutive_source_errors"] == 1
    assert status["source_health_trends"][0]["event_type"] == "failure"
    assert status["source_health_trends"][0]["message"] == "provider failed"


def test_rate_limit_backoff_honors_retry_after():
    assert _rate_limit_backoff_seconds(retry_after_seconds=120, poll_seconds=30, attempts=3) == 120


def test_rate_limit_backoff_uses_exponential_delay_with_cap():
    assert _rate_limit_backoff_seconds(retry_after_seconds=None, poll_seconds=5, attempts=0) == 60
    assert _rate_limit_backoff_seconds(retry_after_seconds=None, poll_seconds=30, attempts=1) == 120
    assert _rate_limit_backoff_seconds(retry_after_seconds=None, poll_seconds=30, attempts=10) == MAX_RATE_LIMIT_BACKOFF_SECONDS


def test_source_unavailable_timeout_uses_exponential_backoff():
    error = AdsbSourceUnavailableError("https://api.example.test/aircraft", message="ADS-B source timed out; backing off")

    assert _rate_limit_backoff_seconds(error.retry_after_seconds, poll_seconds=30, attempts=0) == 60
    assert _rate_limit_backoff_seconds(error.retry_after_seconds, poll_seconds=30, attempts=1) == 120


def test_source_error_log_label_exposes_failure_type():
    assert _source_error_log_label(AdsbAccessDeniedError("https://api.example.test/aircraft")) == "access denied"
    assert _source_error_log_label(AdsbRateLimitError("https://api.example.test/aircraft")) == "rate limited"
    assert _source_error_log_label(AdsbSourceUnavailableError("https://api.example.test/aircraft")) == "unavailable"


def test_write_rate_limit_status_records_retry_details(tmp_path):
    settings = Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
    )
    status_path = tmp_path / "status.json"

    write_rate_limit_status(status_path, settings, AdsbRateLimitError("https://api.example.test/aircraft"), 120)

    status = read_status(status_path)
    assert status["status"] == "rate_limited"
    assert status["rate_limit_backoff_seconds"] == 120
    assert status["rate_limit_retry_at"]
    assert status["last_error"] == "ADS-B source rate limit reached"
    assert status["consecutive_source_errors"] == 1
    assert status["source_health"]["status"] == "rate_limited"
    assert status["source_health"]["provider"] == "direct"
    assert status["source_health"]["retry_at"] == status["rate_limit_retry_at"]
    assert status["source_health"]["backoff_seconds"] == 120
    assert status["source_health"]["last_error"] == "ADS-B source rate limit reached"
    event_types = [event["event_type"] for event in status["source_health_trends"]]
    assert event_types == ["failure", "rate_limit", "retry_backoff"]


def test_write_source_status_records_access_denied(tmp_path):
    settings = Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
    )
    status_path = tmp_path / "status.json"

    write_rate_limit_status(status_path, settings, AdsbAccessDeniedError("https://api.example.test/aircraft"), 120)

    status = read_status(status_path)
    assert status["status"] == "access_denied"
    assert status["rate_limit_backoff_seconds"] == 120
    assert status["last_error"] == "ADS-B source access denied; backing off"
    assert status["consecutive_source_errors"] == 1
    assert status["source_health"]["status"] == "access_denied"
    assert status["source_health"]["last_failure_at"] == status["last_error_at"]


def test_write_source_unavailable_status_records_network_failure(tmp_path):
    settings = Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
    )
    status_path = tmp_path / "status.json"

    write_rate_limit_status(status_path, settings, AdsbSourceUnavailableError("https://api.example.test/aircraft"), 60)

    status = read_status(status_path)
    assert status["status"] == "source_unavailable"
    assert status["rate_limit_backoff_seconds"] == 60
    assert status["consecutive_source_errors"] == 1
    assert status["source_health"]["status"] == "source_unavailable"


def test_write_source_status_records_retry_backoff_for_unavailable_source(tmp_path):
    settings = Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
    )
    status_path = tmp_path / "status.json"

    write_rate_limit_status(status_path, settings, AdsbSourceUnavailableError("https://api.example.test/aircraft"), 60)

    status = read_status(status_path)
    event_types = [event["event_type"] for event in status["source_health_trends"]]
    assert event_types == ["failure", "retry_backoff"]


def test_source_health_trends_survive_restarts_and_prune_by_retention(tmp_path):
    settings = Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
        source_health_trend_retention_hours=1,
    )
    recent_event = {
        "event_type": "failure",
        "observed_at": (datetime.now(timezone.utc) - timedelta(minutes=10)).isoformat(),
        "status": "failing",
        "provider": "direct",
        "query": "aircraft_json",
        "url": "http://example.test/aircraft.json",
        "message": "recent failure",
    }
    old_event = {
        "event_type": "rate_limit",
        "observed_at": (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat(),
        "status": "rate_limited",
        "provider": "direct",
        "query": "aircraft_json",
        "url": "http://example.test/aircraft.json",
        "message": "old rate limit",
    }
    status_path = tmp_path / "status.json"
    status_path.write_text(json.dumps({"source_health_trends": [recent_event, old_event]}), encoding="utf-8")

    write_poll_status(status_path, settings, aircraft_count=4, sightings=[])

    status = read_status(status_path)
    messages = [event["message"] for event in status["source_health_trends"]]
    assert "Poll succeeded with 4 aircraft" in messages
    assert "recent failure" in messages
    assert "old rate limit" not in messages


def test_write_poll_status_records_provider_switch_trend(tmp_path):
    settings = Settings(
        adsb_url="",
        adsb_source=AdsbSource(provider="adsb_lol", query="point", radius_miles=25),
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
    )
    status_path = tmp_path / "status.json"
    status_path.write_text(
        json.dumps(
            {
                "source_health": {
                    "status": "healthy",
                    "provider": "direct",
                    "query": "aircraft_json",
                    "url": "http://example.test/aircraft.json",
                }
            }
        ),
        encoding="utf-8",
    )

    write_poll_status(status_path, settings, aircraft_count=4, sightings=[])

    status = read_status(status_path)
    event_types = [event["event_type"] for event in status["source_health_trends"]]
    assert event_types == ["provider_switch", "success"]
    assert status["source_health_trends"][0]["previous_provider"] == "direct"


def test_source_error_alert_waits_for_threshold_and_respects_cooldown():
    settings = Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[],
        source_error_alerts=SourceErrorAlerts(enabled=True, failure_threshold=3, cooldown_minutes=60),
    )
    sent = []

    class NotificationsStub:
        def send_operational_alert(self, title, message):
            sent.append((title, message))

    state = SourceFailureState()
    now = datetime(2026, 8, 15, 12, 0, tzinfo=timezone.utc)

    assert _maybe_send_source_error_alert(state, settings, NotificationsStub(), RuntimeError("boom 1"), now=now) is False
    assert _maybe_send_source_error_alert(state, settings, NotificationsStub(), RuntimeError("boom 2"), now=now) is False
    assert _maybe_send_source_error_alert(state, settings, NotificationsStub(), RuntimeError("boom 3"), now=now) is True
    assert _maybe_send_source_error_alert(state, settings, NotificationsStub(), RuntimeError("boom 4"), now=now + timedelta(minutes=10)) is False
    assert _maybe_send_source_error_alert(state, settings, NotificationsStub(), RuntimeError("boom 5"), now=now + timedelta(minutes=61)) is True

    assert [title for title, _ in sent] == ["ADS-B source unhealthy", "ADS-B source unhealthy"]
    assert "5 consecutive times" in sent[-1][1]
