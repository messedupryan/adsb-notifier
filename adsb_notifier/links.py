from __future__ import annotations

from urllib.parse import urlencode


ADSB_EXCHANGE_GLOBE_URL = "https://globe.adsbexchange.com/"


def adsb_exchange_aircraft_url(hex_id: str | None) -> str:
    aircraft_hex = str(hex_id or "").strip().upper()
    if not aircraft_hex:
        return ""
    return f"{ADSB_EXCHANGE_GLOBE_URL}?{urlencode({'icao': aircraft_hex})}"
