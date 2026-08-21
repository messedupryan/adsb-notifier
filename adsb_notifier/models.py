from dataclasses import dataclass, field
from datetime import datetime, timezone


@dataclass(frozen=True)
class Aircraft:
    hex: str
    flight: str | None = None
    registration: str | None = None
    aircraft_type: str | None = None
    category: str | None = None
    source_type: str | None = None
    lat: float | None = None
    lon: float | None = None
    altitude_ft: int | None = None
    track_deg: float | None = None
    seen_seconds: float | None = None
    squawk: str | None = None
    emergency: str | None = None
    military: bool = False
    raw: dict = field(default_factory=dict)

    @property
    def label(self) -> str:
        return self.registration or self.flight or self.hex

    @property
    def is_tisb(self) -> bool:
        return self.hex.startswith("~") or (self.source_type or "").startswith("tisb")


@dataclass(frozen=True)
class Sighting:
    aircraft: Aircraft
    distance_miles: float
    rule_name: str
    event_type: str
    home_lat: float | None = None
    home_lon: float | None = None
    rule_radius_miles: float | None = None
    notification_providers: set[str] | None = None
    suppressed_notification_providers: set[str] = field(default_factory=set)
    observed_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
