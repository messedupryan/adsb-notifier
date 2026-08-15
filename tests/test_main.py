import json
from datetime import datetime, timedelta, timezone

from adsb_notifier.config import Home, Notifications, Settings, SourceErrorAlerts
from adsb_notifier.main import (
    MAX_RATE_LIMIT_BACKOFF_SECONDS,
    SourceFailureState,
    _apply_overrides,
    _maybe_send_source_error_alert,
    _rate_limit_backoff_seconds,
)
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
        ),
        distance_miles=4.2,
        rule_name="target",
        event_type="tail",
        notification_providers={"pushover"},
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
    assert status["recent_matches"][0]["source_type"] == "adsb_icao"
    assert status["recent_matches"][0]["airplanes_live_url"] == "https://globe.airplanes.live/?icao=ABC123"
    assert status["recent_matches_window_hours"] == 24


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


def test_rate_limit_backoff_honors_retry_after():
    assert _rate_limit_backoff_seconds(retry_after_seconds=120, poll_seconds=30, attempts=3) == 120


def test_rate_limit_backoff_uses_exponential_delay_with_cap():
    assert _rate_limit_backoff_seconds(retry_after_seconds=None, poll_seconds=5, attempts=0) == 60
    assert _rate_limit_backoff_seconds(retry_after_seconds=None, poll_seconds=30, attempts=1) == 120
    assert _rate_limit_backoff_seconds(retry_after_seconds=None, poll_seconds=30, attempts=10) == MAX_RATE_LIMIT_BACKOFF_SECONDS


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

    write_rate_limit_status(status_path, settings, RuntimeError("ADS-B source rate limit reached"), 120)

    status = read_status(status_path)
    assert status["status"] == "rate_limited"
    assert status["rate_limit_backoff_seconds"] == 120
    assert status["rate_limit_retry_at"]
    assert status["last_error"] == "ADS-B source rate limit reached"
    assert status["consecutive_source_errors"] == 1


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
