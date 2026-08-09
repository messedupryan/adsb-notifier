from adsb_notifier.config import Home, Notifications, Settings
from adsb_notifier.main import _apply_overrides
from adsb_notifier.models import Aircraft, Sighting
from adsb_notifier.status import read_status, write_error_status, write_poll_status


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
        aircraft=Aircraft(hex="ABC123", registration="N12345", aircraft_type="C172"),
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


def test_write_error_status_preserves_previous_poll_summary(tmp_path):
    status_path = tmp_path / "status.json"
    status_path.write_text('{"aircraft_count": 12, "recent_matches": []}', encoding="utf-8")

    write_error_status(status_path, RuntimeError("provider failed"))

    status = read_status(status_path)
    assert status["status"] == "error"
    assert status["aircraft_count"] == 12
    assert status["last_error"] == "provider failed"
