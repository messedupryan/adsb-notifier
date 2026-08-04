from adsb_notifier.adsb import parse_aircraft_payload


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

