from __future__ import annotations

import base64
import json
import logging
import os
import smtplib
from email.message import EmailMessage
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from adsb_notifier.config import Notifications
from adsb_notifier.models import Aircraft, Sighting

LOGGER = logging.getLogger(__name__)


class NotificationFanout:
    def __init__(self, config: Notifications):
        self.config = config

    def send(self, sighting: Sighting) -> None:
        message = format_sighting(sighting)
        sent = False
        if self.config.email and self.config.email.get("enabled", True):
            send_email(self.config.email, message)
            sent = True
        if self.config.twilio and self.config.twilio.get("enabled", True):
            send_twilio_sms(self.config.twilio, message)
            sent = True
        if self.config.webhook and self.config.webhook.get("enabled", True):
            send_webhook(self.config.webhook, sighting, message)
            sent = True
        if self.config.twitter and self.config.twitter.get("enabled", False):
            LOGGER.warning("Twitter/X posting is configured but not implemented; use webhook integration for now.")
        if not sent:
            LOGGER.info("Notification: %s", message)


def send_test_notification(config: Notifications, provider: str) -> None:
    message = "ADS-B Notifier test notification"
    sighting = Sighting(
        aircraft=Aircraft(
            hex="TEST01",
            registration="NTEST",
            aircraft_type="TEST",
            altitude_ft=12345,
            raw={"hex": "TEST01", "registration": "NTEST", "type": "TEST"},
        ),
        distance_miles=1.2,
        rule_name="test-notification",
        event_type="test",
    )

    if provider == "email":
        if not config.email or not config.email.get("enabled", True):
            raise ValueError("email notifications are not enabled")
        send_email(config.email, message)
        return
    if provider == "twilio":
        if not config.twilio or not config.twilio.get("enabled", True):
            raise ValueError("twilio notifications are not enabled")
        send_twilio_sms(config.twilio, message)
        return
    if provider == "webhook":
        if not config.webhook or not config.webhook.get("enabled", True):
            raise ValueError("webhook notifications are not enabled")
        send_webhook(config.webhook, sighting, message)
        return
    raise ValueError(f"unsupported notification provider: {provider}")


def format_sighting(sighting: Sighting) -> str:
    plane = sighting.aircraft
    altitude = f"{plane.altitude_ft} ft" if plane.altitude_ft is not None else "unknown altitude"
    aircraft_type = plane.aircraft_type or plane.category or "unknown type"
    return (
        f"{sighting.rule_name}: {plane.label} ({aircraft_type}) "
        f"{sighting.distance_miles:.1f} mi away at {altitude}"
    )


def send_email(config: dict, message: str) -> None:
    email = EmailMessage()
    email["Subject"] = config.get("subject", "ADS-B alert")
    email["From"] = _secret_or_value(config["from"])
    email["To"] = ", ".join(_secret_or_value(value) for value in config["to"]) if isinstance(config["to"], list) else _secret_or_value(config["to"])
    email.set_content(message)

    host = config["smtp_host"]
    port = int(config.get("smtp_port", 587))
    username = _optional_secret_or_value(config.get("username"))
    password = _optional_secret_or_value(config.get("password"))

    with smtplib.SMTP(host, port, timeout=15) as smtp:
        if config.get("starttls", True):
            smtp.starttls()
        if username and password:
            smtp.login(username, password)
        smtp.send_message(email)


def send_twilio_sms(config: dict, message: str) -> None:
    account_sid = _secret_or_value(config["account_sid"])
    auth_token = _secret_or_value(config["auth_token"])
    body = urlencode({"From": config["from"], "To": config["to"], "Body": message}).encode("utf-8")
    auth = base64.b64encode(f"{account_sid}:{auth_token}".encode("utf-8")).decode("ascii")
    request = Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
        data=body,
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        response.read()


def send_webhook(config: dict, sighting: Sighting, message: str) -> None:
    payload = {
        "message": message,
        "rule": sighting.rule_name,
        "event_type": sighting.event_type,
        "distance_miles": round(sighting.distance_miles, 2),
        "aircraft": sighting.aircraft.raw,
        "observed_at": sighting.observed_at.isoformat(),
    }
    request = Request(
        _secret_or_value(config["url"]),
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        response.read()


def _optional_secret_or_value(value: str | None) -> str | None:
    return None if value is None else _secret_or_value(value)


def _secret_or_value(value: str) -> str:
    if value.startswith("env:"):
        env_name = value.split(":", 1)[1]
        try:
            return os.environ[env_name]
        except KeyError as exc:
            raise ValueError(f"missing required environment variable: {env_name}") from exc
    return value
