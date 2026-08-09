from __future__ import annotations

import argparse
import logging
import os
import signal
import time
from dataclasses import replace
from pathlib import Path

from adsb_notifier.adsb import fetch_aircraft_for_settings
from adsb_notifier.config import Settings, load_settings
from adsb_notifier.notifiers import NotificationFanout
from adsb_notifier.rules import RuleEngine
from adsb_notifier.status import write_error_status, write_poll_status

LOGGER = logging.getLogger(__name__)
SHOULD_STOP = False


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

    while not SHOULD_STOP:
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

            aircraft = fetch_aircraft_for_settings(settings)
            sightings = engine.evaluate(aircraft)
            for sighting in sightings:
                notifications.send(sighting)
            write_poll_status(args.status_file, settings, len(aircraft), sightings)
            LOGGER.info("poll complete aircraft=%s notifications=%s", len(aircraft), len(sightings))
        except Exception as exc:
            write_error_status(args.status_file, exc)
            LOGGER.exception("poll failed")

        if args.once:
            break
        time.sleep(settings.poll_seconds)


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


if __name__ == "__main__":
    main()
