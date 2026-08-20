from email.message import Message
from urllib.error import HTTPError, URLError

import pytest

from adsb_notifier.adsb import (
    AdsbAccessDeniedError,
    AdsbRateLimitError,
    AdsbSourceUnavailableError,
    USER_AGENT,
    build_adsb_url,
    fetch_aircraft,
    parse_aircraft_payload,
)
from adsb_notifier.version import __version__
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
                    "squawk": "0421",
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
    assert aircraft[0].squawk == "0421"


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


def test_parse_airplanes_live_dbflags_military_bit():
    aircraft = parse_aircraft_payload(
        {
            "ac": [
                {
                    "hex": "ae21a1",
                    "flight": "G8524557",
                    "r": "86-24557",
                    "t": "H60",
                    "dbFlags": 1,
                    "lat": 40.613525,
                    "lon": -111.99498,
                    "alt_baro": "ground",
                }
            ]
        }
    )

    assert len(aircraft) == 1
    assert aircraft[0].hex == "AE21A1"
    assert aircraft[0].military is True
    assert aircraft[0].altitude_ft == 0


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


def test_parse_tisb_aircraft_sets_source_type():
    aircraft = parse_aircraft_payload(
        {
            "ac": [
                {
                    "hex": "~29e466",
                    "type": "tisb_other",
                    "lat": 40.8,
                    "lon": -111.9,
                    "alt_baro": 10800,
                }
            ]
        }
    )

    assert len(aircraft) == 1
    assert aircraft[0].source_type == "tisb_other"
    assert aircraft[0].is_tisb is True
    assert aircraft[0].military is False


def test_parse_numeric_squawk_preserves_four_digit_code():
    aircraft = parse_aircraft_payload(
        {
            "aircraft": [
                {
                    "hex": "a12345",
                    "lat": 40.8,
                    "lon": -111.9,
                    "squawk": 75,
                }
            ]
        }
    )

    assert aircraft[0].squawk == "0075"


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


def test_fetch_aircraft_raises_rate_limit_error_with_retry_after(monkeypatch):
    headers = Message()
    headers["Retry-After"] = "120"

    def fake_urlopen(request, timeout):
        del request, timeout
        raise HTTPError("https://api.example.test/aircraft", 429, "Too Many Requests", headers, None)

    monkeypatch.setattr("adsb_notifier.adsb.urlopen", fake_urlopen)

    with pytest.raises(AdsbRateLimitError) as error:
        fetch_aircraft("https://api.example.test/aircraft")

    assert error.value.retry_after_seconds == 120


def test_fetch_aircraft_raises_backoff_error_for_forbidden(monkeypatch):
    def fake_urlopen(request, timeout):
        del request, timeout
        raise HTTPError("https://api.example.test/aircraft", 403, "Forbidden", Message(), None)

    monkeypatch.setattr("adsb_notifier.adsb.urlopen", fake_urlopen)

    with pytest.raises(AdsbAccessDeniedError) as error:
        fetch_aircraft("https://api.example.test/aircraft")

    assert error.value.status_code == 403
    assert str(error.value) == "ADS-B source access denied; backing off"


def test_fetch_aircraft_raises_source_unavailable_for_timeout(monkeypatch):
    def fake_urlopen(request, timeout):
        del request, timeout
        raise TimeoutError("The read operation timed out")

    monkeypatch.setattr("adsb_notifier.adsb.urlopen", fake_urlopen)

    with pytest.raises(AdsbSourceUnavailableError) as error:
        fetch_aircraft("https://api.example.test/aircraft")

    assert error.value.status_code is None
    assert error.value.retry_after_seconds is None
    assert str(error.value) == "ADS-B source timed out; backing off"


def test_fetch_aircraft_raises_source_unavailable_for_url_error(monkeypatch):
    def fake_urlopen(request, timeout):
        del request, timeout
        raise URLError("connection reset")

    monkeypatch.setattr("adsb_notifier.adsb.urlopen", fake_urlopen)

    with pytest.raises(AdsbSourceUnavailableError) as error:
        fetch_aircraft("https://api.example.test/aircraft")

    assert error.value.status_code is None
    assert str(error.value) == "ADS-B source connection failed; backing off: connection reset"


def test_fetch_aircraft_uses_versioned_user_agent(monkeypatch):
    requests = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            del exc_type, exc, traceback

        def read(self):
            return b'{"aircraft": []}'

    def fake_urlopen(request, timeout):
        del timeout
        requests.append(request)
        return FakeResponse()

    monkeypatch.setattr("adsb_notifier.adsb.urlopen", fake_urlopen)

    assert fetch_aircraft("https://api.example.test/aircraft") == []
    assert requests[0].headers["User-agent"] == USER_AGENT
    assert USER_AGENT.startswith(f"adsb-notifier/{__version__}")


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
