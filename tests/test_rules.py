from datetime import datetime, timedelta, timezone

from adsb_notifier.config import Home, Notifications, Rule, Settings
from adsb_notifier.models import Aircraft
from adsb_notifier.rules import RuleEngine


def settings_with(rule: Rule) -> Settings:
    return Settings(
        adsb_url="http://example.test/aircraft.json",
        adsb_source=None,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=[rule],
    )


def test_tail_rule_matches_inside_radius_and_altitude_limit():
    engine = RuleEngine(
        settings_with(
            Rule(
                name="target",
                event="tail",
                tail_numbers={"N12345"},
                radius_miles=10,
                max_altitude_ft=10000,
            )
        )
    )

    sightings = engine.evaluate(
        [
            Aircraft(
                hex="A12345",
                registration="N12345",
                lat=40.7708,
                lon=-111.8910,
                altitude_ft=5000,
            )
        ]
    )

    assert len(sightings) == 1
    assert sightings[0].rule_name == "target"


def test_tail_rule_rejects_above_max_altitude():
    engine = RuleEngine(
        settings_with(
            Rule(
                name="target",
                event="tail",
                tail_numbers={"N12345"},
                radius_miles=10,
                max_altitude_ft=1000,
            )
        )
    )

    sightings = engine.evaluate(
        [
            Aircraft(
                hex="A12345",
                registration="N12345",
                lat=40.7708,
                lon=-111.8910,
                altitude_ft=5000,
            )
        ]
    )

    assert sightings == []


def test_disabled_rule_does_not_match():
    engine = RuleEngine(
        settings_with(
            Rule(
                name="target",
                event="tail",
                tail_numbers={"N12345"},
                radius_miles=10,
                enabled=False,
            )
        )
    )

    sightings = engine.evaluate(
        [
            Aircraft(
                hex="A12345",
                registration="N12345",
                lat=40.7708,
                lon=-111.8910,
                altitude_ft=5000,
            )
        ]
    )

    assert sightings == []


def test_aircraft_type_rule_matches_type_or_category():
    engine = RuleEngine(
        settings_with(
            Rule(
                name="helo",
                event="aircraft_type",
                radius_miles=10,
                aircraft_types={"H60"},
            )
        )
    )

    sightings = engine.evaluate([Aircraft(hex="AE0001", aircraft_type="H60", lat=40.7708, lon=-111.8910)])

    assert len(sightings) == 1


def test_military_rule_rejects_civilian_aircraft_even_without_rule_flag():
    engine = RuleEngine(settings_with(Rule(name="mil", event="military", radius_miles=10, military=None)))

    sightings = engine.evaluate(
        [
            Aircraft(
                hex="A9BCDE",
                registration="N875DN",
                flight="DAL123",
                lat=40.7708,
                lon=-111.8910,
                military=False,
            )
        ]
    )

    assert sightings == []


def test_military_rule_matches_military_flagged_aircraft():
    engine = RuleEngine(settings_with(Rule(name="mil", event="military", radius_miles=10, military=None)))

    sightings = engine.evaluate(
        [
            Aircraft(
                hex="AE0001",
                flight="RCH123",
                lat=40.7708,
                lon=-111.8910,
                military=True,
            )
        ]
    )

    assert len(sightings) == 1
    assert sightings[0].event_type == "military"


def test_military_rule_rejects_tisb_track_by_default():
    engine = RuleEngine(settings_with(Rule(name="mil", event="military", radius_miles=10, include_tisb=False)))

    sightings = engine.evaluate(
        [
            Aircraft(
                hex="~29E466",
                source_type="tisb_other",
                lat=40.7708,
                lon=-111.8910,
                military=False,
            )
        ]
    )

    assert sightings == []


def test_military_rule_matches_tisb_track_when_enabled():
    engine = RuleEngine(settings_with(Rule(name="mil", event="military", radius_miles=10, include_tisb=True)))

    sightings = engine.evaluate(
        [
            Aircraft(
                hex="~29E466",
                source_type="tisb_other",
                lat=40.7708,
                lon=-111.8910,
                military=False,
            )
        ]
    )

    assert len(sightings) == 1
    assert sightings[0].aircraft.is_tisb is True


def test_cooldown_suppresses_duplicate_notifications():
    now = datetime(2026, 7, 23, tzinfo=timezone.utc)
    engine = RuleEngine(
        settings_with(
            Rule(
                name="target",
                event="tail",
                tail_numbers={"N12345"},
                radius_miles=10,
                cooldown_minutes=30,
            )
        )
    )
    aircraft = [Aircraft(hex="A12345", registration="N12345", lat=40.7708, lon=-111.8910)]

    assert len(engine.evaluate(aircraft, now=now)) == 1
    assert engine.evaluate(aircraft, now=now + timedelta(minutes=5)) == []
    assert len(engine.evaluate(aircraft, now=now + timedelta(minutes=31))) == 1


def test_circling_rule_detects_accumulated_heading_change():
    now = datetime(2026, 7, 23, tzinfo=timezone.utc)
    engine = RuleEngine(
        settings_with(
            Rule(
                name="orbit",
                event="circling",
                radius_miles=10,
                circling_min_heading_change_deg=270,
                circling_window_minutes=8,
            )
        )
    )

    headings = [0, 90, 180, 270]
    for index, heading in enumerate(headings):
        sightings = engine.evaluate(
            [Aircraft(hex="A12345", lat=40.7708, lon=-111.8910, track_deg=heading)],
            now=now + timedelta(minutes=index),
        )

    assert len(sightings) == 1
    assert sightings[0].event_type == "circling"
