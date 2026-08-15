from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
INDEX_HTML = (ROOT / "ui" / "index.html").read_text(encoding="utf-8")
UI_JS = "\n".join(path.read_text(encoding="utf-8") for path in sorted((ROOT / "ui" / "js").glob("*.js")))
PROJECT_VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()


class InputParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.inputs: dict[str, dict[str, str]] = {}
        self.selects: set[str] = set()
        self.tabs: set[str] = set()
        self.textareas: set[str] = set()
        self.scripts: list[str] = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        classes = set(attributes.get("class", "").split())
        if tag == "button" and "tab" in classes and attributes.get("data-tab"):
            self.tabs.add(attributes["data-tab"])
            return
        if tag == "textarea" and attributes.get("id"):
            self.textareas.add(attributes["id"])
            return
        if tag == "select" and attributes.get("id"):
            self.selects.add(attributes["id"])
            return
        if tag == "script" and attributes.get("src"):
            self.scripts.append(attributes["src"])
            return
        if tag != "input":
            return
        if attributes.get("id"):
            self.inputs[attributes["id"]] = attributes


def test_ui_asset_versions_match_visible_version():
    expected_version = f'const uiVersion = "{PROJECT_VERSION}";'

    assert expected_version in UI_JS
    assert f"ADS-B Notifier {PROJECT_VERSION}" in INDEX_HTML
    assert f"UI {PROJECT_VERSION}" in INDEX_HTML
    assert f"?v={PROJECT_VERSION}" in INDEX_HTML
    assert f"/js/bootstrap.js?v={PROJECT_VERSION}" in INDEX_HTML
    assert "20260810-2" not in INDEX_HTML
    assert "20260810-1" not in INDEX_HTML
    assert "20260809-12" not in INDEX_HTML


def test_ui_javascript_is_split_into_ordered_scripts():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    expected_scripts = [
        f"/js/state.js?v={PROJECT_VERSION}",
        f"/js/theme.js?v={PROJECT_VERSION}",
        f"/js/config-flow.js?v={PROJECT_VERSION}",
        f"/js/dashboard.js?v={PROJECT_VERSION}",
        f"/js/forms.js?v={PROJECT_VERSION}",
        f"/js/rule-actions.js?v={PROJECT_VERSION}",
        f"/js/modal.js?v={PROJECT_VERSION}",
        f"/js/validation.js?v={PROJECT_VERSION}",
        f"/js/rule-model.js?v={PROJECT_VERSION}",
        f"/js/map-utils.js?v={PROJECT_VERSION}",
        f"/js/ui-utils.js?v={PROJECT_VERSION}",
        f"/js/bootstrap.js?v={PROJECT_VERSION}",
    ]

    assert "/app.js" not in INDEX_HTML
    assert parser.scripts[-len(expected_scripts) :] == expected_scripts


def test_removed_webhook_provider_is_not_in_ui():
    assert "webhook" not in INDEX_HTML.lower()
    assert '"webhook"' not in UI_JS


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


def test_adsb_source_controls_are_available_in_settings():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    assert "adsb-source-provider" in parser.selects
    assert "adsb-source-query" in parser.selects
    assert "adsb-source-radius" in parser.inputs
    assert "adsb-source-value" in parser.inputs
    assert "adsb-source-base-url" in parser.inputs
    assert "adsb_lol" in INDEX_HTML
    assert "airplanes_live" in INDEX_HTML
    assert "Direct aircraft.json" in INDEX_HTML


def test_ui_bootstrap_helpers_are_defined():
    for helper in [
        "normalizeConfig",
        "cloneConfig",
        "normalizeRuleNotificationProviders",
        "selectExistingRuleId",
    ]:
        assert f"function {helper}" in UI_JS
