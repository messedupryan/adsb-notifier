from adsb_notifier.links import adsb_exchange_aircraft_url


def test_adsb_exchange_aircraft_url_uses_icao_parameter():
    assert adsb_exchange_aircraft_url("a0b1c2") == "https://globe.adsbexchange.com/?icao=A0B1C2"


def test_adsb_exchange_aircraft_url_encodes_non_icao_prefix():
    assert adsb_exchange_aircraft_url("~29e466") == "https://globe.adsbexchange.com/?icao=~29E466"


def test_adsb_exchange_aircraft_url_returns_empty_for_missing_hex():
    assert adsb_exchange_aircraft_url("") == ""
