from adsb_notifier.adsb import build_adsb_url, parse_aircraft_payload
from adsb_notifier.config import AdsbSource, Home, Notifications, Rule, Settings


def test_parse_dump1090_aircraft_payload():
    aircraft = parse_aircraft_payload(
        {
            "aircraft": [
                {
                    "hex": "a12345",
                    "flight": " TEST123 ",
                    "r": "n12345",
                    "t": "c172",
                    "lat": 40.8,
                    "lon": -111.9,
                    "alt_baro": "5500",
                    "track": 90,
                    "seen": 1.2,
                }
            ]
        }
    )

    assert len(aircraft) == 1
    assert aircraft[0].hex == "A12345"
    assert aircraft[0].registration == "N12345"
    assert aircraft[0].aircraft_type == "C172"
    assert aircraft[0].altitude_ft == 5500


def test_parse_skips_aircraft_without_position():
    assert parse_aircraft_payload({"aircraft": [{"hex": "abc123"}]}) == []


def test_parse_airplanes_live_payload():
    aircraft = parse_aircraft_payload(
        {
            "ac": [
                {
                    "hex": "abc123",
                    "flight": "UAL123",
                    "r": "N12345",
                    "t": "B738",
                    "lat": 40.8,
                    "lon": -111.9,
                    "alt_baro": 12000,
                    "track": 270,
                    "military": "false",
                }
            ]
        }
    )

    assert len(aircraft) == 1
    assert aircraft[0].registration == "N12345"
    assert aircraft[0].aircraft_type == "B738"
    assert aircraft[0].military is False


def test_parse_adsb_lol_payload_with_alt_alias_and_military_flag():
    aircraft = parse_aircraft_payload(
        {
            "aircraft": [
                {
                    "hex": "ae0001",
                    "flight": "RCH123",
                    "lat": 40.8,
                    "lon": -111.9,
                    "alt": 9000,
                    "mil": True,
                }
            ]
        }
    )

    assert len(aircraft) == 1
    assert aircraft[0].hex == "AE0001"
    assert aircraft[0].altitude_ft == 9000
    assert aircraft[0].military is True


def test_build_airplanes_live_point_url_uses_configured_radius():
    settings = settings_with_source(
        AdsbSource(provider="airplanes_live", query="point", radius_miles=40),
        [Rule(name="target", event="tail", radius_miles=10, cooldown_minutes=30)],
    )

    assert build_adsb_url(settings) == "https://api.airplanes.live/v2/point/40.7608/-111.891/40"


def test_build_adsb_lol_point_url_defaults_to_largest_enabled_rule_radius():
    settings = settings_with_source(
        AdsbSource(provider="adsb_lol", query="point"),
        [
            Rule(name="small", event="tail", radius_miles=10, cooldown_minutes=30, enabled=False),
            Rule(name="large", event="tail", radius_miles=55, cooldown_minutes=30),
        ],
    )

    assert build_adsb_url(settings) == "https://api.adsb.lol/v2/point/40.7608/-111.891/55"


def test_build_source_specific_lookup_url():
    settings = settings_with_source(
        AdsbSource(provider="airplanes_live", query="reg", value="N12345"),
        [Rule(name="target", event="tail", radius_miles=10, cooldown_minutes=30)],
    )

    assert build_adsb_url(settings) == "https://api.airplanes.live/v2/reg/N12345"


def settings_with_source(source: AdsbSource, rules: list[Rule]) -> Settings:
    return Settings(
        adsb_url="http://cluster/aircraft.json",
        adsb_source=source,
        home=Home(lat=40.7608, lon=-111.8910),
        poll_seconds=30,
        stale_aircraft_seconds=90,
        notifications=Notifications(),
        rules=rules,
    )
