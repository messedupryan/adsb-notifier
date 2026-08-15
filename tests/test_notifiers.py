import base64

from adsb_notifier.models import Aircraft, Sighting
from adsb_notifier.notifiers import (
    NotificationFanout,
    render_email_body,
    render_email_html_body,
    render_email_subject,
    email_inline_images,
    render_pushover_message,
    render_pushover_title,
    render_pushover_url,
    render_pushover_url_title,
    render_sms_message,
    send_email,
    send_pushover,
    send_twilio_sms,
)


def test_send_email_expands_env_values(monkeypatch):
    sent_messages = []
    login_calls = []

    class FakeSmtp:
        def __init__(self, host, port, timeout):
            assert host == "smtp.gmail.com"
            assert port == 587
            assert timeout == 15

        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def starttls(self):
            return None

        def login(self, username, password):
            login_calls.append((username, password))

        def send_message(self, message):
            sent_messages.append(message)

    monkeypatch.setenv("SMTP_USERNAME", "pilot@example.test")
    monkeypatch.setenv("SMTP_PASSWORD", "app-password")
    monkeypatch.setattr("adsb_notifier.notifiers.smtplib.SMTP", FakeSmtp)

    send_email(
        {
            "smtp_host": "smtp.gmail.com",
            "smtp_port": 587,
            "starttls": True,
            "username": "env:SMTP_USERNAME",
            "password": "env:SMTP_PASSWORD",
            "from": "env:SMTP_USERNAME",
            "to": ["env:SMTP_USERNAME"],
        },
        "ADS-B Notifier test notification",
        html_message='<p><a href="https://example.test">Airplanes.live</a></p>',
    )

    assert login_calls == [("pilot@example.test", "app-password")]
    assert sent_messages[0]["From"] == "pilot@example.test"
    assert sent_messages[0]["To"] == "pilot@example.test"
    assert sent_messages[0].is_multipart()
    assert sent_messages[0].get_body(("html",)).get_content().strip() == '<p><a href="https://example.test">Airplanes.live</a></p>'


def test_send_twilio_sms_uses_api_key_credentials(monkeypatch):
    requests = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def read(self):
            return b"{}"

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return FakeResponse()

    monkeypatch.setenv("TWILIO_ACCOUNT_SID", "AC12345678901234567890123456789012")
    monkeypatch.setenv("TWILIO_API_KEY_SID", "SK12345678901234567890123456789012")
    monkeypatch.setenv("TWILIO_API_KEY_SECRET", "api-secret")
    monkeypatch.setenv("TWILIO_FROM", "+15551234567")
    monkeypatch.setenv("TWILIO_TO", "+15557654321")
    monkeypatch.setattr("adsb_notifier.notifiers.urlopen", fake_urlopen)

    send_twilio_sms(
        {
            "account_sid": "env:TWILIO_ACCOUNT_SID",
            "api_key_sid": "env:TWILIO_API_KEY_SID",
            "api_key_secret": "env:TWILIO_API_KEY_SECRET",
            "from": "env:TWILIO_FROM",
            "to": "env:TWILIO_TO",
        },
        "ADS-B SMS test",
    )

    request, timeout = requests[0]
    expected_auth = base64.b64encode(b"SK12345678901234567890123456789012:api-secret").decode("ascii")
    assert timeout == 15
    assert request.full_url == "https://api.twilio.com/2010-04-01/Accounts/AC12345678901234567890123456789012/Messages.json"
    assert request.headers["Authorization"] == f"Basic {expected_auth}"


def test_send_twilio_sms_falls_back_to_auth_token(monkeypatch):
    requests = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def read(self):
            return b"{}"

    def fake_urlopen(request, timeout):
        requests.append(request)
        return FakeResponse()

    monkeypatch.setattr("adsb_notifier.notifiers.urlopen", fake_urlopen)

    send_twilio_sms(
        {
            "account_sid": "AC12345678901234567890123456789012",
            "auth_token": "account-token",
            "from": "+15551234567",
            "to": "+15557654321",
        },
        "ADS-B SMS test",
    )

    expected_auth = base64.b64encode(b"AC12345678901234567890123456789012:account-token").decode("ascii")
    assert requests[0].headers["Authorization"] == f"Basic {expected_auth}"


def test_send_pushover_posts_expected_payload(monkeypatch):
    requests = []

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, exc_type, exc, traceback):
            return None

        def read(self):
            return b"{}"

    def fake_urlopen(request, timeout):
        requests.append((request, timeout))
        return FakeResponse()

    monkeypatch.setenv("PUSHOVER_APP_TOKEN", "app-token")
    monkeypatch.setenv("PUSHOVER_USER_KEY", "user-key")
    monkeypatch.setattr("adsb_notifier.notifiers.urlopen", fake_urlopen)

    send_pushover(
        {
            "app_token": "env:PUSHOVER_APP_TOKEN",
            "user_key": "env:PUSHOVER_USER_KEY",
            "device": "phone",
            "priority": 1,
            "sound": "pushover",
        },
        "ADS-B Pushover test",
        title="ADS-B alert",
        url="https://globe.airplanes.live/?icao=A0B1C2",
        url_title="Track aircraft",
    )

    request, timeout = requests[0]
    body = request.data.decode("utf-8")
    assert timeout == 15
    assert request.full_url == "https://api.pushover.net/1/messages.json"
    assert "token=app-token" in body
    assert "user=user-key" in body
    assert "message=ADS-B+Pushover+test" in body
    assert "title=ADS-B+alert" in body
    assert "url=https%3A%2F%2Fglobe.airplanes.live%2F%3Ficao%3DA0B1C2" in body
    assert "url_title=Track+aircraft" in body
    assert "device=phone" in body
    assert "priority=1" in body
    assert "sound=pushover" in body


def test_fanout_sends_only_selected_rule_providers(monkeypatch):
    sent = []

    monkeypatch.setattr(
        "adsb_notifier.notifiers.send_email",
        lambda config, message, subject=None, html_message=None, inline_images=None: sent.append("email"),
    )
    monkeypatch.setattr("adsb_notifier.notifiers.send_twilio_sms", lambda config, message: sent.append("twilio"))
    monkeypatch.setattr("adsb_notifier.notifiers.send_pushover", lambda config, message, title=None, url=None, url_title=None: sent.append("pushover"))

    sighting = sample_sighting()
    sighting = Sighting(
        aircraft=sighting.aircraft,
        distance_miles=sighting.distance_miles,
        rule_name=sighting.rule_name,
        event_type=sighting.event_type,
        notification_providers={"pushover"},
        observed_at=sighting.observed_at,
    )

    NotificationFanout(
        config=type(
            "Notifications",
            (),
            {
                "email": {"enabled": True, "from": "from@example.test", "to": "to@example.test"},
                "twilio": {"enabled": True},
                "pushover": {"enabled": True, "app_token": "token", "user_key": "user"},
            },
        )()
    ).send(sighting)

    assert sent == ["pushover"]


def test_fanout_defaults_missing_rule_providers_to_all_enabled(monkeypatch):
    sent = []

    monkeypatch.setattr(
        "adsb_notifier.notifiers.send_email",
        lambda config, message, subject=None, html_message=None, inline_images=None: sent.append("email"),
    )
    monkeypatch.setattr("adsb_notifier.notifiers.send_pushover", lambda config, message, title=None, url=None, url_title=None: sent.append("pushover"))

    NotificationFanout(
        config=type(
            "Notifications",
            (),
            {
                "email": {"enabled": True, "from": "from@example.test", "to": "to@example.test"},
                "twilio": None,
                "pushover": {"enabled": True, "app_token": "token", "user_key": "user"},
            },
        )()
    ).send(sample_sighting())

    assert sent == ["email", "pushover"]


def test_email_templates_render_rich_aircraft_fields():
    sighting = sample_sighting()
    config = {
        "subject_template": "ADS-B: {aircraft_label} matched {rule_name}",
        "body_template": "Aircraft {registration} / {flight}\nType {aircraft_type}\n{distance_miles:.1f} mi, {altitude_label}, {vertical_rate_label}",
        "html_enabled": True,
        "html_body_template": '<p><a href="{airplanes_live_url_html}">Airplanes.live</a></p>',
        "include_brand_images": False,
    }

    assert render_email_subject(config, sighting) == "ADS-B: N123AB matched TEST TAIL NUMBER"
    assert render_email_body(config, sighting) == (
        "Aircraft N123AB / TEST123\n"
        "Type BCS1\n"
        "27.0 mi, 10850 ft, descending 640 ft/min"
    )
    assert render_email_html_body(config, sighting) == '<p><a href="https://globe.airplanes.live/?icao=A0B1C2">Airplanes.live</a></p>'


def test_email_html_body_wraps_with_inline_brand_images_by_default():
    html = render_email_html_body({"html_enabled": True, "html_body_template": "<p>{aircraft_label_html}</p>"}, sample_sighting())

    assert 'src="cid:adsb-notifier-logo"' in html
    assert 'src="cid:adsb-notifier-icon"' in html
    assert "<p>N123AB</p>" in html


def test_email_html_body_is_explicitly_enabled():
    assert render_email_html_body({"html_body_template": "<p>{aircraft_label_html}</p>"}, sample_sighting()) is None


def test_email_inline_images_use_selected_theme():
    images = email_inline_images({"html_enabled": True, "html_body_template": "<p>body</p>", "brand_theme": "amber"})

    assert [image.cid for image in images] == ["adsb-notifier-logo", "adsb-notifier-icon"]
    assert all(image.data.startswith(b"\x89PNG") for image in images)


def test_email_inline_images_can_be_disabled():
    assert email_inline_images({"html_enabled": True, "html_body_template": "<p>body</p>", "include_brand_images": False}) == []
    assert email_inline_images({"html_body_template": "<p>body</p>"}) == []


def test_sms_template_can_be_shorter_than_email():
    sighting = sample_sighting()

    assert (
        render_sms_message({"body_template": "{rule_name}: {aircraft_label} {distance_miles_1}mi {altitude_ft}ft"}, sighting)
        == "TEST TAIL NUMBER: N123AB 27.0mi 10850ft"
    )


def test_templates_include_airplanes_live_url():
    sighting = sample_sighting()

    assert (
        render_email_body({"body_template": "Track: {airplanes_live_url}"}, sighting)
        == "Track: https://globe.airplanes.live/?icao=A0B1C2"
    )


def test_legacy_adsb_exchange_template_variable_points_to_airplanes_live():
    sighting = sample_sighting()

    assert (
        render_email_body({"body_template": "Track: {adsb_exchange_url}"}, sighting)
        == "Track: https://globe.airplanes.live/?icao=A0B1C2"
    )


def test_pushover_templates_are_independent():
    sighting = sample_sighting()
    config = {
        "title_template": "{aircraft_label} near home",
        "message_template": "{rule_name}: {aircraft_label} {distance_miles_1} mi {altitude_label}",
        "url_template": "{airplanes_live_url}",
        "url_title_template": "Track {aircraft_label}",
    }

    assert render_pushover_title(config, sighting) == "N123AB near home"
    assert render_pushover_message(config, sighting) == "TEST TAIL NUMBER: N123AB 27.0 mi 10850 ft"
    assert render_pushover_url(config, sighting) == "https://globe.airplanes.live/?icao=A0B1C2"
    assert render_pushover_url_title(config, sighting) == "Track N123AB"


def test_pushover_defaults_to_airplanes_live_link():
    sighting = sample_sighting()

    assert render_pushover_url({}, sighting) == "https://globe.airplanes.live/?icao=A0B1C2"
    assert render_pushover_url_title({}, sighting) == "Airplanes.live"


def test_pushover_airplanes_live_link_can_be_disabled():
    sighting = sample_sighting()

    assert render_pushover_url({"include_airplanes_live_link": False}, sighting) == ""
    assert render_pushover_url_title({"include_airplanes_live_link": False}, sighting) == ""


def test_template_missing_placeholder_renders_empty():
    sighting = sample_sighting()

    assert render_sms_message({"body_template": "{aircraft_label}{unknown_field}"}, sighting) == "N123AB"


def sample_sighting() -> Sighting:
    return Sighting(
        aircraft=Aircraft(
            hex="A0B1C2",
            flight="TEST123",
            registration="N123AB",
            aircraft_type="BCS1",
            category="A3",
            lat=40.76,
            lon=-111.89,
            altitude_ft=10850,
            track_deg=204,
            seen_seconds=3.4,
            raw={
                "desc": "Airbus A220-100",
                "ownOp": "Delta Air Lines",
                "gs": 295,
                "baro_rate": -640,
                "squawk": "1200",
            },
        ),
        distance_miles=27.04,
        rule_name="TEST TAIL NUMBER",
        event_type="tail",
    )
