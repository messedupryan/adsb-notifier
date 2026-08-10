from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

from adsb_notifier.config import Rule, Settings
from adsb_notifier.geo import distance_miles
from adsb_notifier.models import Aircraft, Sighting


@dataclass
class TrackPoint:
    observed_at: datetime
    heading: float


@dataclass
class RuleEngine:
    settings: Settings
    last_sent: dict[tuple[str, str], datetime] = field(default_factory=dict)
    tracks: dict[str, deque[TrackPoint]] = field(default_factory=lambda: defaultdict(deque))

    def evaluate(self, aircraft: list[Aircraft], now: datetime | None = None) -> list[Sighting]:
        observed_at = now or datetime.now(timezone.utc)
        sightings: list[Sighting] = []
        for plane in aircraft:
            if plane.seen_seconds and plane.seen_seconds > self.settings.stale_aircraft_seconds:
                continue
            if plane.track_deg is not None:
                self._record_track(plane.hex, plane.track_deg, observed_at)
            for rule in self.settings.rules:
                if not rule.enabled:
                    continue
                sighting = self._evaluate_rule(rule, plane, observed_at)
                if sighting and self._should_send(rule, plane, observed_at):
                    sightings.append(sighting)
                    self.last_sent[(rule.name, plane.hex)] = observed_at
        return sightings

    def _evaluate_rule(self, rule: Rule, plane: Aircraft, observed_at: datetime) -> Sighting | None:
        if plane.lat is None or plane.lon is None:
            return None

        distance = distance_miles(self.settings.home.lat, self.settings.home.lon, plane.lat, plane.lon)
        if distance > rule.radius_miles:
            return None
        if not _altitude_matches(rule, plane):
            return None

        if rule.event == "tail":
            if not _tail_matches(rule, plane):
                return None
        elif rule.event == "military":
            if not plane.military and not (rule.include_tisb and plane.is_tisb):
                return None
        elif rule.event == "aircraft_type":
            if not _type_matches(rule, plane):
                return None
        elif rule.event == "circling":
            if not self._is_circling(rule, plane.hex, observed_at):
                return None
        else:
            return None

        return Sighting(
            aircraft=plane,
            distance_miles=distance,
            rule_name=rule.name,
            event_type=rule.event,
            notification_providers=rule.notification_providers,
            observed_at=observed_at,
        )

    def _record_track(self, aircraft_hex: str, heading: float, observed_at: datetime) -> None:
        points = self.tracks[aircraft_hex]
        points.append(TrackPoint(observed_at=observed_at, heading=heading % 360))
        cutoff = observed_at - timedelta(minutes=max(rule.circling_window_minutes for rule in self.settings.rules))
        while points and points[0].observed_at < cutoff:
            points.popleft()

    def _is_circling(self, rule: Rule, aircraft_hex: str, observed_at: datetime) -> bool:
        cutoff = observed_at - timedelta(minutes=rule.circling_window_minutes)
        headings = [point.heading for point in self.tracks[aircraft_hex] if point.observed_at >= cutoff]
        if len(headings) < 4:
            return False
        # Accumulate the smallest turn between consecutive tracks so wraparound
        # headings like 350 -> 010 count as a 20 degree turn, not 340 degrees.
        heading_change = sum(_smallest_heading_delta(a, b) for a, b in zip(headings, headings[1:]))
        return heading_change >= rule.circling_min_heading_change_deg

    def _should_send(self, rule: Rule, plane: Aircraft, observed_at: datetime) -> bool:
        previous = self.last_sent.get((rule.name, plane.hex))
        if previous is None:
            return True
        return observed_at - previous >= timedelta(minutes=rule.cooldown_minutes)


def _tail_matches(rule: Rule, plane: Aircraft) -> bool:
    candidates = {value for value in (plane.registration, plane.flight, plane.hex) if value}
    return bool(candidates & rule.tail_numbers)


def _type_matches(rule: Rule, plane: Aircraft) -> bool:
    return bool({value for value in (plane.aircraft_type, plane.category) if value} & (rule.aircraft_types | rule.categories))


def _altitude_matches(rule: Rule, plane: Aircraft) -> bool:
    if rule.min_altitude_ft is not None and (plane.altitude_ft is None or plane.altitude_ft < rule.min_altitude_ft):
        return False
    if rule.max_altitude_ft is not None and (plane.altitude_ft is None or plane.altitude_ft > rule.max_altitude_ft):
        return False
    return True


def _smallest_heading_delta(start: float, end: float) -> float:
    return abs((end - start + 180) % 360 - 180)
