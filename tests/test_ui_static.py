from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "ui" / "index.html").read_text(encoding="utf-8")
APP_JS = (ROOT / "ui" / "app.js").read_text(encoding="utf-8")
PROJECT_VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()


class InputParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inputs: dict[str, dict[str, str]] = {}
        self.tabs: set[str] = set()
        self.textareas: set[str] = set()

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = set(attributes.get("class", "").split())
        if tag == "button" and "tab" in classes and attributes.get("data-tab"):
            self.tabs.add(attributes["data-tab"])
            return
        if tag == "textarea" and attributes.get("id"):
            self.textareas.add(attributes["id"])
            return
        if tag != "input":
            return
        if attributes.get("id"):
            self.inputs[attributes["id"]] = attributes


def test_ui_asset_versions_match_visible_version():
    expected_version = f'const uiVersion = "{PROJECT_VERSION}";'

    assert expected_version in APP_JS
    assert f"ADS-B Notifier {PROJECT_VERSION}" in INDEX_HTML
    assert f"UI {PROJECT_VERSION}" in INDEX_HTML
    assert f"?v={PROJECT_VERSION}" in INDEX_HTML
    assert "20260810-2" not in INDEX_HTML
    assert "20260810-1" not in INDEX_HTML
    assert "20260809-12" not in INDEX_HTML


def test_removed_webhook_provider_is_not_in_ui():
    assert "webhook" not in INDEX_HTML.lower()
    assert '"webhook"' not in APP_JS


def test_secret_notification_fields_are_password_inputs():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    for field_id in ["email-password", "pushover-app-token", "pushover-user-key", "twilio-api-key-secret"]:
        assert parser.inputs[field_id]["type"] == "password"


def test_pushover_link_template_fields_are_available():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    assert "pushover-url-template" in parser.inputs
    assert "pushover-url-title-template" in parser.inputs


def test_email_html_and_brand_fields_are_available():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    assert "email-html-enabled" in parser.inputs
    assert "email-brand-theme" in INDEX_HTML
    assert "email-include-brand-images" in parser.inputs
    assert "email-html-body-template" in parser.textareas


def test_json_editor_lives_under_settings_not_top_level_tabs():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    assert parser.tabs == {"dashboard", "settings", "notifications", "rules"}
    assert "config-json" in parser.textareas
    assert 'id="json" class="tab-panel"' not in INDEX_HTML
