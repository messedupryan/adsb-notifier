import argparse
import logging
import os
import signal
import time
from dataclasses import dataclass, replace
from datetime import datetime, timedelta, timezone
from pathlib import Path

from adsb_notifier.adsb import AdsbSourceUnavailableError, AdsbStaleDataError, build_adsb_url, fetch_aircraft_for_settings
from adsb_notifier.config import Settings, load_settings
from adsb_notifier.constants import (
    DEFAULT_RATE_LIMIT_BACKOFF_SECONDS,
    MAX_RATE_LIMIT_BACKOFF_SECONDS,
)
from adsb_notifier.notifiers import NotificationFanout
from adsb_notifier.rules import RuleEngine
from adsb_notifier.status import write_error_status, write_poll_status, write_rate_limit_status

LOGGER = logging.getLogger(__name__)
SHOULD_STOP = False


@dataclass
class SourceFailureState:
    consecutive_failures: int = 0
    last_alert_at: datetime | None = None


@dataclass
class SourceFailoverState:
    retry_primary_at: datetime | None = None


@dataclass(frozen=True)
class SourceFetchResult:
    aircraft: list
    settings: Settings
    primary_error: AdsbSourceUnavailableError | None = None
    primary_backoff_seconds: int = 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor ADS-B data and send configured notifications.")
    parser.add_argument("--config", default="/config/config.json", help="Path to JSON config file.")
    parser.add_argument("--adsb-url", help="Override the ADS-B aircraft.json URL for this worker process.")
    parser.add_argument(
        "--status-file",
        default=os.environ.get("ADSB_STATUS_FILE", "status.json"),
        help="Path to write worker status JSON after each poll.",
    )
    parser.add_argument("--once", action="store_true", help="Run one poll and exit.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    config_path = Path(args.config)
    config_location = args.config
    settings = _apply_overrides(_load_initial_settings(config_location), args.adsb_url)
    config_mtime = _config_mtime(config_path) if not _is_url(config_location) else None
    engine = RuleEngine(settings)
    notifications = NotificationFanout(settings.notifications)
    rate_limit_attempts = 0
    source_failure_state = SourceFailureState()
    source_failover_state = SourceFailoverState()

    while not SHOULD_STOP:
        sleep_seconds = settings.poll_seconds
        source_fetch_complete = False
        try:
            if _is_url(config_location):
                next_settings = _apply_overrides(load_settings(config_location), args.adsb_url)
                if next_settings != settings:
                    settings = next_settings
                    engine = RuleEngine(settings)
                    notifications = NotificationFanout(settings.notifications)
                    LOGGER.info("config reloaded from %s", config_location)
            else:
                next_mtime = _config_mtime(config_path)
                if next_mtime != config_mtime:
                    settings = _apply_overrides(load_settings(config_path), args.adsb_url)
                    config_mtime = next_mtime
                    engine = RuleEngine(settings)
                    notifications = NotificationFanout(settings.notifications)
                    LOGGER.info("config reloaded from %s", config_path)

            fetch_result = fetch_aircraft_with_failover(settings, source_failover_state, rate_limit_attempts)
            aircraft = fetch_result.aircraft
            source_fetch_complete = True
            sightings = engine.evaluate(aircraft)
            for sighting in sightings:
                notifications.send(sighting)
            if fetch_result.primary_error is not None:
                write_rate_limit_status(
                    args.status_file,
                    settings,
                    fetch_result.primary_error,
                    fetch_result.primary_backoff_seconds,
                )
                _maybe_send_source_error_alert(source_failure_state, settings, notifications, fetch_result.primary_error)
            write_poll_status(args.status_file, fetch_result.settings, len(aircraft), sightings)
            LOGGER.info(
                "poll complete aircraft=%s notifications=%s source=%s",
                len(aircraft),
                len(sightings),
                _safe_adsb_source_url(fetch_result.settings),
            )
            rate_limit_attempts = 0
            if fetch_result.primary_error is None:
                source_failure_state.consecutive_failures = 0
        except AdsbSourceUnavailableError as exc:
            sleep_seconds = _rate_limit_backoff_seconds(
                retry_after_seconds=exc.retry_after_seconds,
                poll_seconds=settings.poll_seconds,
                attempts=rate_limit_attempts,
            )
            rate_limit_attempts += 1
            write_rate_limit_status(args.status_file, settings, exc, sleep_seconds)
            _maybe_send_source_error_alert(source_failure_state, settings, notifications, exc)
            LOGGER.warning(
                "ADS-B source %s status=%s; backing off for %ss",
                _source_error_log_label(exc),
                exc.status_code or "network",
                sleep_seconds,
            )
        except Exception as exc:
            rate_limit_attempts = 0
            write_error_status(args.status_file, exc)
            if not source_fetch_complete:
                _maybe_send_source_error_alert(source_failure_state, settings, notifications, exc)
            LOGGER.exception("poll failed")

        if args.once:
            break
        time.sleep(sleep_seconds)


def _handle_stop(signum: int, frame: object) -> None:
    del signum, frame
    global SHOULD_STOP
    SHOULD_STOP = True


def _config_mtime(path: Path) -> float:
    return path.stat().st_mtime


def _is_url(location: str) -> bool:
    return location.startswith(("http://", "https://"))


def _load_initial_settings(config_location: str) -> Settings:
    while not SHOULD_STOP:
        try:
            return load_settings(config_location)
        except Exception:
            LOGGER.exception("unable to load config from %s; retrying", config_location)
            time.sleep(5)
    raise SystemExit(0)


def _apply_overrides(settings: Settings, adsb_url: str | None = None) -> Settings:
    if not adsb_url:
        return settings
    return replace(settings, adsb_url=adsb_url, adsb_source=None)


def fetch_aircraft_with_failover(
    settings: Settings,
    state: SourceFailoverState,
    attempts: int,
    now: datetime | None = None,
) -> SourceFetchResult:
    now = now or datetime.now(timezone.utc)
    backup_settings = _backup_source_settings(settings)
    if backup_settings and state.retry_primary_at and now < state.retry_primary_at:
        return SourceFetchResult(aircraft=fetch_aircraft_for_settings(backup_settings), settings=backup_settings)

    try:
        aircraft = fetch_aircraft_for_settings(settings)
        _raise_if_source_data_stale(settings, aircraft)
        state.retry_primary_at = None
        return SourceFetchResult(aircraft=aircraft, settings=settings)
    except AdsbSourceUnavailableError as exc:
        if not backup_settings:
            raise
        backoff_seconds = _rate_limit_backoff_seconds(
            retry_after_seconds=exc.retry_after_seconds,
            poll_seconds=settings.poll_seconds,
            attempts=attempts,
        )
        state.retry_primary_at = now + timedelta(minutes=settings.primary_retry_minutes)
        LOGGER.warning(
            "primary ADS-B source failed (%s); using backup until %s",
            exc,
            state.retry_primary_at.isoformat(),
        )
        return SourceFetchResult(
            aircraft=fetch_aircraft_for_settings(backup_settings),
            settings=backup_settings,
            primary_error=exc,
            primary_backoff_seconds=backoff_seconds,
        )


def _backup_source_settings(settings: Settings) -> Settings | None:
    if settings.backup_adsb_source is None:
        return None
    return replace(settings, adsb_source=settings.backup_adsb_source, adsb_url="")


def _raise_if_source_data_stale(settings: Settings, aircraft: list) -> None:
    stale_samples = [plane.seen_seconds for plane in aircraft if plane.seen_seconds is not None]
    if stale_samples and all(seconds > settings.stale_aircraft_seconds for seconds in stale_samples):
        raise AdsbStaleDataError(build_adsb_url(settings))


def _rate_limit_backoff_seconds(
    retry_after_seconds: int | None,
    poll_seconds: int,
    attempts: int,
) -> int:
    if retry_after_seconds is not None:
        return max(1, retry_after_seconds)

    base_delay = max(DEFAULT_RATE_LIMIT_BACKOFF_SECONDS, poll_seconds * 2)
    return min(MAX_RATE_LIMIT_BACKOFF_SECONDS, base_delay * (2**attempts))


def _source_error_log_label(error: BaseException) -> str:
    match getattr(error, "status_code", None):
        case 403:
            return "access denied"
        case 429:
            return "rate limited"
        case _:
            return "unavailable"


def _maybe_send_source_error_alert(
    state: SourceFailureState,
    settings: Settings,
    notifications: NotificationFanout,
    error: BaseException,
    now: datetime | None = None,
) -> bool:
    state.consecutive_failures += 1
    config = settings.source_error_alerts
    if not config.enabled or state.consecutive_failures < config.failure_threshold:
        return False

    now = now or datetime.now(timezone.utc)
    cooldown = timedelta(minutes=config.cooldown_minutes)
    if state.last_alert_at and now - state.last_alert_at < cooldown:
        return False

    source_url = _safe_adsb_source_url(settings)
    title = "ADS-B source unhealthy"
    message = (
        f"ADS-B Notifier has failed to pull aircraft data {state.consecutive_failures} consecutive times.\n"
        f"Source: {source_url}\n"
        f"Last error: {error}"
    )
    try:
        notifications.send_operational_alert(title, message)
        state.last_alert_at = now
        LOGGER.warning("sent ADS-B source unhealthy alert failures=%s", state.consecutive_failures)
        return True
    except Exception:
        LOGGER.exception("failed to send ADS-B source unhealthy alert")
        return False


def _safe_adsb_source_url(settings: Settings) -> str:
    try:
        from adsb_notifier.adsb import build_adsb_url

        return build_adsb_url(settings)
    except Exception as exc:
        return f"unavailable ({exc})"


if __name__ == "__main__":
    main()
