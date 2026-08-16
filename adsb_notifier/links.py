from urllib.parse import urlencode


AIRPLANES_LIVE_GLOBE_URL = "https://globe.airplanes.live/"


def airplanes_live_aircraft_url(hex_id: str | None) -> str:
    aircraft_hex = str(hex_id or "").strip().upper()
    if not aircraft_hex:
        return ""
    return f"{AIRPLANES_LIVE_GLOBE_URL}?{urlencode({'icao': aircraft_hex})}"


def adsb_exchange_aircraft_url(hex_id: str | None) -> str:
    return airplanes_live_aircraft_url(hex_id)
