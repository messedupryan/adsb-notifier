from __future__ import annotations

import base64
import html
import logging
import os
import smtplib
from dataclasses import dataclass
from email.message import EmailMessage
from importlib import resources
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from adsb_notifier.config import Notifications
from adsb_notifier.links import adsb_exchange_aircraft_url
from adsb_notifier.models import Aircraft, Sighting

LOGGER = logging.getLogger(__name__)
EMAIL_BRAND_THEMES = {"amber", "blue", "rose", "teal", "violet"}
EMAIL_LOGO_CID = "adsb-notifier-logo"
EMAIL_ICON_CID = "adsb-notifier-icon"
LEGACY_COMPACT_EMAIL_HTML_BODY_TEMPLATE = (
    '<p>{message_html}</p><p><a href="{adsb_exchange_url_html}">ADS-B Exchange</a></p>'
    '<table><tr><th align="left">Aircraft</th><td>{aircraft_label_html}</td></tr>'
    '<tr><th align="left">Registration</th><td>{registration_html}</td></tr>'
    '<tr><th align="left">Flight</th><td>{flight_html}</td></tr>'
    '<tr><th align="left">Type</th><td>{aircraft_type_html}</td></tr>'
    '<tr><th align="left">Description</th><td>{description_html}</td></tr>'
    '<tr><th align="left">Operator</th><td>{operator_html}</td></tr>'
    '<tr><th align="left">Altitude</th><td>{altitude_label_html}</td></tr>'
    '<tr><th align="left">Distance</th><td>{distance_miles:.1f} mi</td></tr>'
    '<tr><th align="left">Track</th><td>{track_label_html}</td></tr>'
    '<tr><th align="left">Speed</th><td>{ground_speed_label_html}</td></tr>'
    '<tr><th align="left">Vertical rate</th><td>{vertical_rate_label_html}</td></tr>'
    '<tr><th align="left">Squawk</th><td>{squawk_html}</td></tr>'
    '<tr><th align="left">Seen</th><td>{seen_label_html}</td></tr>'
    '<tr><th align="left">Hex</th><td>{hex_html}</td></tr>'
    '<tr><th align="left">Rule</th><td>{rule_name_html}</td></tr>'
    '<tr><th align="left">Observed</th><td>{observed_at_html}</td></tr></table>'
)
DEFAULT_EMAIL_HTML_BODY_TEMPLATE = """\
<p>{message_html}</p>

<p>
  <a href="{adsb_exchange_url_html}">ADS-B Exchange</a>
</p>

<table>
  <tr>
    <th align="left">Aircraft</th>
    <td>{aircraft_label_html}</td>
  </tr>
  <tr>
    <th align="left">Registration</th>
    <td>{registration_html}</td>
  </tr>
  <tr>
    <th align="left">Flight</th>
    <td>{flight_html}</td>
  </tr>
  <tr>
    <th align="left">Type</th>
    <td>{aircraft_type_html}</td>
  </tr>
  <tr>
    <th align="left">Description</th>
    <td>{description_html}</td>
  </tr>
  <tr>
    <th align="left">Operator</th>
    <td>{operator_html}</td>
  </tr>
  <tr>
    <th align="left">Altitude</th>
    <td>{altitude_label_html}</td>
  </tr>
  <tr>
    <th align="left">Distance</th>
    <td>{distance_miles:.1f} mi</td>
  </tr>
  <tr>
    <th align="left">Track</th>
    <td>{track_label_html}</td>
  </tr>
  <tr>
    <th align="left">Speed</th>
    <td>{ground_speed_label_html}</td>
  </tr>
  <tr>
    <th align="left">Vertical rate</th>
    <td>{vertical_rate_label_html}</td>
  </tr>
  <tr>
    <th align="left">Squawk</th>
    <td>{squawk_html}</td>
  </tr>
  <tr>
    <th align="left">Seen</th>
    <td>{seen_label_html}</td>
  </tr>
  <tr>
    <th align="left">Hex</th>
    <td>{hex_html}</td>
  </tr>
  <tr>
    <th align="left">Rule</th>
    <td>{rule_name_html}</td>
  </tr>
  <tr>
    <th align="left">Observed</th>
    <td>{observed_at_html}</td>
  </tr>
</table>
""".strip()


@dataclass(frozen=True)
class InlineEmailImage:
    cid: str
    data: bytes
    subtype: str = "png"


class NotificationFanout:
    def __init__(self, config: Notifications):
        self.config = config

    def send(self, sighting: Sighting) -> None:
        message = format_sighting(sighting)
        selected_providers = sighting.notification_providers
        sent = False
        if self._should_send_provider("email", selected_providers):
            send_email(
                self.config.email,
                render_email_body(self.config.email, sighting, message),
                subject=render_email_subject(self.config.email, sighting, message),
                html_message=render_email_html_body(self.config.email, sighting, message),
                inline_images=email_inline_images(self.config.email),
            )
            sent = True
        if self._should_send_provider("twilio", selected_providers):
            send_twilio_sms(self.config.twilio, render_sms_message(self.config.twilio, sighting, message))
            sent = True
        if self._should_send_provider("pushover", selected_providers):
            send_pushover(
                self.config.pushover,
                render_pushover_message(self.config.pushover, sighting, message),
                title=render_pushover_title(self.config.pushover, sighting, message),
                url=render_pushover_url(self.config.pushover, sighting),
                url_title=render_pushover_url_title(self.config.pushover, sighting),
            )
            sent = True
        if not sent:
            LOGGER.info("Notification: %s", message)

    def _should_send_provider(self, provider: str, selected_providers: set[str] | None) -> bool:
        provider_config = getattr(self.config, provider)
        if not provider_config or not provider_config.get("enabled", True):
            return False
        return selected_providers is None or provider in selected_providers


def send_test_notification(config: Notifications, provider: str) -> None:
    sighting = Sighting(
        aircraft=Aircraft(
            hex="TEST01",
            flight="TEST123",
            registration="NTEST",
            aircraft_type="TEST",
            category="A1",
            lat=40.7608,
            lon=-111.891,
            altitude_ft=12345,
            track_deg=183,
            seen_seconds=4.2,
            raw={
                "hex": "TEST01",
                "flight": "TEST123",
                "registration": "NTEST",
                "type": "TEST",
                "category": "A1",
                "desc": "Test aircraft",
                "ownOp": "ADS-B Notifier",
                "gs": 210,
                "baro_rate": 500,
                "squawk": "1200",
            },
        ),
        distance_miles=1.2,
        rule_name="test-notification",
        event_type="test",
    )
    message = "ADS-B Notifier test notification"

    if provider == "email":
        if not config.email or not config.email.get("enabled", True):
            raise ValueError("email notifications are not enabled")
        send_email(
            config.email,
            render_email_body(config.email, sighting, message),
            subject=render_email_subject(config.email, sighting, message),
            html_message=render_email_html_body(config.email, sighting, message),
            inline_images=email_inline_images(config.email),
        )
        return
    if provider == "twilio":
        if not config.twilio or not config.twilio.get("enabled", True):
            raise ValueError("twilio notifications are not enabled")
        send_twilio_sms(config.twilio, render_sms_message(config.twilio, sighting, message))
        return
    if provider == "pushover":
        if not config.pushover or not config.pushover.get("enabled", True):
            raise ValueError("pushover notifications are not enabled")
        send_pushover(
            config.pushover,
            render_pushover_message(config.pushover, sighting, message),
            title=render_pushover_title(config.pushover, sighting, message),
            url=render_pushover_url(config.pushover, sighting),
            url_title=render_pushover_url_title(config.pushover, sighting),
        )
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


def render_email_subject(config: dict, sighting: Sighting, fallback_message: str | None = None) -> str:
    if config.get("subject_template"):
        return render_template(config["subject_template"], sighting, fallback_message)
    return config.get("subject", "ADS-B alert")


def render_email_body(config: dict, sighting: Sighting, fallback_message: str | None = None) -> str:
    if config.get("body_template"):
        return render_template(config["body_template"], sighting, fallback_message)
    return fallback_message or format_sighting(sighting)


def render_email_html_body(config: dict, sighting: Sighting, fallback_message: str | None = None) -> str | None:
    if not config.get("html_enabled"):
        return None
    body = render_template(config["html_body_template"], sighting, fallback_message)
    return _wrap_email_html_body(config, body)


def _wrap_email_html_body(config: dict, body: str) -> str:
    if config.get("include_brand_images") is False:
        return body
    return (
        '<div style="font-family:Arial,sans-serif;line-height:1.4;color:#17202a;">'
        f'<div style="text-align:center;margin:0 0 18px 0;"><img src="cid:{EMAIL_LOGO_CID}" alt="ADS-B Notifier" width="260" style="max-width:100%;height:auto;" /></div>'
        f"{body}"
        f'<div style="text-align:center;margin:24px 0 0 0;"><img src="cid:{EMAIL_ICON_CID}" alt="" width="48" height="48" /></div>'
        "</div>"
    )


def render_sms_message(config: dict, sighting: Sighting, fallback_message: str | None = None) -> str:
    template = config.get("body_template") or config.get("message_template") or config.get("template")
    if template:
        return render_template(template, sighting, fallback_message)
    return fallback_message or format_sighting(sighting)


def render_pushover_title(config: dict, sighting: Sighting, fallback_message: str | None = None) -> str:
    if config.get("title_template"):
        return render_template(config["title_template"], sighting, fallback_message)
    return config.get("title", "ADS-B alert")


def render_pushover_message(config: dict, sighting: Sighting, fallback_message: str | None = None) -> str:
    template = config.get("message_template") or config.get("body_template") or config.get("template")
    if template:
        return render_template(template, sighting, fallback_message)
    return fallback_message or format_sighting(sighting)


def render_pushover_url(config: dict, sighting: Sighting) -> str:
    if config.get("include_adsb_exchange_link") is False:
        return ""
    if config.get("url_template"):
        return render_template(config["url_template"], sighting)
    return adsb_exchange_aircraft_url(sighting.aircraft.hex)


def render_pushover_url_title(config: dict, sighting: Sighting) -> str:
    if config.get("include_adsb_exchange_link") is False:
        return ""
    if config.get("url_title_template"):
        return render_template(config["url_title_template"], sighting)
    return "ADS-B Exchange"


def render_template(template: str, sighting: Sighting, fallback_message: str | None = None) -> str:
    return template.format_map(_TemplateContext(template_context(sighting, fallback_message)))


def template_context(sighting: Sighting, fallback_message: str | None = None) -> dict[str, object]:
    plane = sighting.aircraft
    raw = plane.raw or {}
    altitude_label = f"{plane.altitude_ft} ft" if plane.altitude_ft is not None else "unknown altitude"
    ground_speed = _raw_first(raw, "gs", "speed")
    vertical_rate = _raw_first(raw, "baro_rate", "geom_rate")
    track_label = f"{plane.track_deg:.0f} deg" if plane.track_deg is not None else "unknown"
    ground_speed_label = f"{ground_speed} kt" if ground_speed not in (None, "") else "unknown"
    seen_label = f"{plane.seen_seconds:.1f}s ago" if plane.seen_seconds is not None else "unknown"

    context = {
        "message": fallback_message or format_sighting(sighting),
        "rule_name": sighting.rule_name,
        "event_type": sighting.event_type,
        "observed_at": sighting.observed_at.isoformat(),
        "distance_miles": sighting.distance_miles,
        "distance_miles_1": f"{sighting.distance_miles:.1f}",
        "aircraft_label": plane.label,
        "registration": plane.registration or "",
        "flight": plane.flight or "",
        "hex": plane.hex,
        "adsb_exchange_url": adsb_exchange_aircraft_url(plane.hex),
        "aircraft_type": plane.aircraft_type or plane.category or "unknown type",
        "category": plane.category or "",
        "description": raw.get("desc") or "",
        "operator": raw.get("ownOp") or raw.get("op") or "",
        "altitude_ft": plane.altitude_ft if plane.altitude_ft is not None else "",
        "altitude_label": altitude_label,
        "track_deg": plane.track_deg if plane.track_deg is not None else "",
        "track_label": track_label,
        "ground_speed_kt": ground_speed if ground_speed is not None else "",
        "ground_speed_label": ground_speed_label,
        "vertical_rate_fpm": vertical_rate if vertical_rate is not None else "",
        "vertical_rate_label": _format_vertical_rate(vertical_rate),
        "squawk": raw.get("squawk") or "",
        "emergency": plane.emergency or raw.get("emergency") or "",
        "military": plane.military,
        "lat": plane.lat if plane.lat is not None else "",
        "lon": plane.lon if plane.lon is not None else "",
        "seen_seconds": plane.seen_seconds if plane.seen_seconds is not None else "",
        "seen_label": seen_label,
    }
    context.update({f"{key}_html": html.escape(str(value), quote=True) for key, value in context.items()})
    return context


def send_email(
    config: dict,
    message: str,
    subject: str | None = None,
    html_message: str | None = None,
    inline_images: list[InlineEmailImage] | None = None,
) -> None:
    email = EmailMessage()
    email["Subject"] = subject or config.get("subject", "ADS-B alert")
    email["From"] = _secret_or_value(config["from"])
    email["To"] = ", ".join(_secret_or_value(value) for value in config["to"]) if isinstance(config["to"], list) else _secret_or_value(config["to"])
    email.set_content(message)
    if html_message:
        email.add_alternative(html_message, subtype="html")
        html_part = email.get_payload()[-1]
        for image in inline_images or []:
            html_part.add_related(image.data, maintype="image", subtype=image.subtype, cid=f"<{image.cid}>")

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


def email_inline_images(config: dict) -> list[InlineEmailImage]:
    if not config.get("html_enabled") or config.get("include_brand_images") is False:
        return []
    theme = _email_brand_theme(config)
    return [
        InlineEmailImage(cid=EMAIL_LOGO_CID, data=_email_asset_bytes(f"logo_{theme}.png")),
        InlineEmailImage(cid=EMAIL_ICON_CID, data=_email_asset_bytes(f"icon_{theme}.png")),
    ]


def _email_brand_theme(config: dict) -> str:
    theme = str(config.get("brand_theme") or "teal").strip().lower()
    return theme if theme in EMAIL_BRAND_THEMES else "teal"


def _email_asset_bytes(name: str) -> bytes:
    return resources.files("adsb_notifier").joinpath("assets", "email", name).read_bytes()


def send_twilio_sms(config: dict, message: str) -> None:
    account_sid = _secret_or_value(config["account_sid"])
    auth_username, auth_password = _twilio_auth_credentials(config, account_sid)
    body = urlencode({"From": config["from"], "To": config["to"], "Body": message}).encode("utf-8")
    auth = base64.b64encode(f"{auth_username}:{auth_password}".encode("utf-8")).decode("ascii")
    request = Request(
        f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
        data=body,
        headers={"Authorization": f"Basic {auth}", "Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        response.read()


def _twilio_auth_credentials(config: dict, account_sid: str) -> tuple[str, str]:
    api_key_sid = _optional_secret_or_value(config.get("api_key_sid"))
    api_key_secret = _optional_secret_or_value(config.get("api_key_secret"))
    if api_key_sid and api_key_secret:
        return api_key_sid, api_key_secret

    auth_token = _optional_secret_or_value(config.get("auth_token"))
    if auth_token:
        return account_sid, auth_token

    raise ValueError("twilio requires api_key_sid/api_key_secret or auth_token")


def send_pushover(config: dict, message: str, title: str | None = None, url: str | None = None, url_title: str | None = None) -> None:
    payload: dict[str, object] = {
        "token": _secret_or_value(config["app_token"]),
        "user": _secret_or_value(config["user_key"]),
        "message": message,
    }
    optional_values = {
        "device": config.get("device"),
        "title": title or config.get("title"),
        "url": url,
        "url_title": url_title,
        "priority": config.get("priority"),
        "sound": config.get("sound"),
    }
    for key, value in optional_values.items():
        if value not in (None, ""):
            payload[key] = _secret_or_value(value) if isinstance(value, str) else value

    request = Request(
        "https://api.pushover.net/1/messages.json",
        data=urlencode(payload).encode("utf-8"),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        response.read()


class _TemplateContext(dict):
    def __missing__(self, key: str) -> "_MissingTemplateValue":
        LOGGER.warning("Notification template referenced unknown placeholder: %s", key)
        return _MissingTemplateValue()


class _MissingTemplateValue:
    def __format__(self, format_spec: str) -> str:
        return ""

    def __str__(self) -> str:
        return ""


def _raw_first(raw: dict, *keys: str) -> object | None:
    for key in keys:
        value = raw.get(key)
        if value not in (None, ""):
            return value
    return None


def _format_vertical_rate(value: object | None) -> str:
    if value in (None, ""):
        return "unknown"
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return str(value)
    if rate > 0:
        return f"climbing {rate:.0f} ft/min"
    if rate < 0:
        return f"descending {abs(rate):.0f} ft/min"
    return "level"


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
