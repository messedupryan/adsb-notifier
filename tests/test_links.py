from adsb_notifier.links import airplanes_live_aircraft_url


def test_airplanes_live_aircraft_url_uses_icao_parameter():
    assert airplanes_live_aircraft_url("a0b1c2") == "https://globe.airplanes.live/?icao=A0B1C2"


def test_airplanes_live_aircraft_url_encodes_non_icao_prefix():
    assert airplanes_live_aircraft_url("~29e466") == "https://globe.airplanes.live/?icao=~29E466"


def test_airplanes_live_aircraft_url_returns_empty_for_missing_hex():
    assert airplanes_live_aircraft_url("") == ""
