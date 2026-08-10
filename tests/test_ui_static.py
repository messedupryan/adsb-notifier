from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "ui" / "index.html").read_text(encoding="utf-8")
APP_JS = (ROOT / "ui" / "app.js").read_text(encoding="utf-8")


class InputParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inputs: dict[str, dict[str, str]] = {}

    def handle_starttag(self, tag, attrs):
        if tag != "input":
            return
        attributes = dict(attrs)
        if attributes.get("id"):
            self.inputs[attributes["id"]] = attributes


def test_ui_asset_versions_match_visible_version():
    expected_version = 'const uiVersion = "20260810-1";'

    assert expected_version in APP_JS
    assert "UI 20260810-1" in INDEX_HTML
    assert "?v=20260810-1" in INDEX_HTML
    assert "20260809-12" not in INDEX_HTML


def test_removed_webhook_provider_is_not_in_ui():
    assert "webhook" not in INDEX_HTML.lower()
    assert '"webhook"' not in APP_JS


def test_secret_notification_fields_are_password_inputs():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    for field_id in ["email-password", "pushover-app-token", "pushover-user-key", "twilio-api-key-secret"]:
        assert parser.inputs[field_id]["type"] == "password"
