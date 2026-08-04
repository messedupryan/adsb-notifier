from __future__ import annotations

import argparse
import logging
import signal
import time
from pathlib import Path

from adsb_notifier.adsb import fetch_aircraft
from adsb_notifier.config import Settings, load_settings
from adsb_notifier.notifiers import NotificationFanout
from adsb_notifier.rules import RuleEngine

LOGGER = logging.getLogger(__name__)
SHOULD_STOP = False


def main() -> None:
    parser = argparse.ArgumentParser(description="Monitor ADS-B data and send configured notifications.")
    parser.add_argument("--config", default="/config/config.json", help="Path to JSON config file.")
    parser.add_argument("--once", action="store_true", help="Run one poll and exit.")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    signal.signal(signal.SIGTERM, _handle_stop)
    signal.signal(signal.SIGINT, _handle_stop)

    config_path = Path(args.config)
    config_location = args.config
    settings = _load_initial_settings(config_location)
    config_mtime = _config_mtime(config_path) if not _is_url(config_location) else None
    engine = RuleEngine(settings)
    notifications = NotificationFanout(settings.notifications)

    while not SHOULD_STOP:
        try:
            if _is_url(config_location):
                next_settings = load_settings(config_location)
                if next_settings != settings:
                    settings = next_settings
                    engine = RuleEngine(settings)
                    notifications = NotificationFanout(settings.notifications)
                    LOGGER.info("config reloaded from %s", config_location)
            else:
                next_mtime = _config_mtime(config_path)
                if next_mtime != config_mtime:
                    settings = load_settings(config_path)
                    config_mtime = next_mtime
                    engine = RuleEngine(settings)
                    notifications = NotificationFanout(settings.notifications)
                    LOGGER.info("config reloaded from %s", config_path)

            aircraft = fetch_aircraft(settings.adsb_url)
            sightings = engine.evaluate(aircraft)
            for sighting in sightings:
                notifications.send(sighting)
            LOGGER.info("poll complete aircraft=%s notifications=%s", len(aircraft), len(sightings))
        except Exception:
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


if __name__ == "__main__":
    main()
