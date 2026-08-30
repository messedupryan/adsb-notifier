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
        f"/js/constants.js?v={PROJECT_VERSION}",
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
    assert "email-include-map-snapshot" in parser.inputs
    assert "email-html-body-template" in parser.textareas


def test_notification_provider_selector_and_preview_are_available():
    assert 'id="notification-provider-selector"' in INDEX_HTML
    assert 'data-provider-panel="email"' in INDEX_HTML
    assert 'data-provider-panel="pushover"' in INDEX_HTML
    assert 'data-provider-panel="twilio"' in INDEX_HTML
    assert 'id="notification-preview-source"' in INDEX_HTML
    assert 'id="notification-preview"' in INDEX_HTML
    assert "selectedNotificationProvider" in UI_JS
    assert "function sortedNotificationProviders" in UI_JS
    assert "function selectNotificationProvider" in UI_JS
    assert "function renderNotificationPreview" in UI_JS
    assert "function sampleNotificationPreviewMatch" in UI_JS
    assert "function renderNotificationTemplate" in UI_JS
    assert "function emailHtmlPreviewField" in UI_JS
    assert "function emailHtmlPreviewDocument" in UI_JS
    assert "function emailThemeColor" in UI_JS
    assert 'frame.setAttribute("sandbox", "")' in UI_JS
    assert "emailHtmlPreviewMode" in UI_JS
    assert "dataset.emailHtmlPreviewMode" in UI_JS
    assert "latestWorkerStatus?.recent_matches" in UI_JS


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


def test_squawk_rule_controls_are_available():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    assert "rule-squawk-codes" in parser.inputs
    assert 'value="squawk"' in INDEX_HTML
    assert "squawk_codes" in UI_JS


def test_exclusion_controls_are_available():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    for field_id in [
        "global-exclusion-tail-numbers",
        "global-exclusion-hex-ids",
        "global-exclusion-callsigns",
        "global-exclusion-aircraft-types",
        "global-exclusion-categories",
        "rule-exclusion-tail-numbers",
        "rule-exclusion-hex-ids",
        "rule-exclusion-callsigns",
        "rule-exclusion-aircraft-types",
        "rule-exclusion-categories",
    ]:
        assert field_id in parser.inputs
    assert 'id="category-exclusion-options"' in INDEX_HTML
    assert 'value="A7"' in INDEX_HTML
    assert 'value="UNKNOWN"' in INDEX_HTML
    assert "normalizeExclusions" in UI_JS
    assert "exclusionsFromFields" in UI_JS


def test_rule_match_fields_appear_before_rule_options():
    radius_index = INDEX_HTML.index('id="rule-radius"')
    tail_index = INDEX_HTML.index('id="rule-tail-numbers"')
    notifications_index = INDEX_HTML.index('class="rule-notifications')
    quiet_hours_index = INDEX_HTML.index('class="rule-quiet-hours')
    exclusions_index = INDEX_HTML.index('class="rule-exclusions')

    assert radius_index < notifications_index
    assert tail_index < notifications_index
    assert notifications_index < quiet_hours_index < exclusions_index


def test_rule_search_filter_and_bulk_controls_are_available():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    assert "rule-search" in parser.inputs
    assert "rule-type-filter" in parser.selects
    assert "rule-state-filter" in parser.selects
    assert "rule-selected-count" in INDEX_HTML
    assert "toggle-visible-rules" in INDEX_HTML
    assert "bulk-enable-rules" in INDEX_HTML
    assert "bulk-disable-rules" in INDEX_HTML
    assert 'data-rule-control="true"' in INDEX_HTML
    assert "function ruleMatchesListFilters" in UI_JS
    assert "function toggleVisibleRuleSelection" in UI_JS
    assert "function bulkSetSelectedRulesEnabled" in UI_JS


def test_rule_bulk_actions_save_full_config():
    assert 'fetch(`${apiBase}/config`, {' in UI_JS
    assert "selectedRuleIds" in UI_JS
    assert "syncRuleSelectionToVisible" in UI_JS


def test_dashboard_filter_controls_are_available():
    parser = InputParser()
    parser.feed(INDEX_HTML)

    assert "dashboard-event-filter" in parser.selects
    assert "dashboard-rule-filter" in parser.selects
    assert "dashboard-provider-filter" in parser.selects
    assert "dashboard-status-filter" in parser.selects
    assert "dashboard-search" in parser.inputs
    assert 'data-dashboard-control="true"' in INDEX_HTML
    assert "function filterRecentMatches" in UI_JS


def test_worker_status_summary_has_source_row_and_status_classes():
    assert "worker-primary" in INDEX_HTML
    assert "worker-source source-url" in INDEX_HTML
    assert "status-value" in UI_JS
    assert "function statusClassName" in UI_JS
    assert "rate-limited" in UI_JS


def test_recent_match_detail_view_is_available():
    assert "match-detail-modal" in INDEX_HTML
    assert "match-detail-link" in INDEX_HTML
    assert "match-detail-export-json" in INDEX_HTML
    assert "match-detail-export-csv" in INDEX_HTML
    assert "match-detail-summary" in INDEX_HTML
    assert "match-detail-payload" in INDEX_HTML
    assert "function openMatchDetail" in UI_JS
    assert "function recentMatchExportUrl" in UI_JS
    assert "recent-matches/export.${format}" in UI_JS
    assert "match_key=${encodeURIComponent(key)}" in UI_JS
    assert "function renderMatchDetailSummary" in UI_JS
    assert "aircraft_payload" in UI_JS


def test_recent_match_multi_export_controls_are_available():
    assert "toggle-recent-export" in INDEX_HTML
    assert 'id="recent-export-actions" class="recent-export-actions hidden"' in INDEX_HTML
    assert "recent-export-selected-count" in INDEX_HTML
    assert "select-visible-matches" in INDEX_HTML
    assert "clear-selected-matches" in INDEX_HTML
    assert "export-selected-json" in INDEX_HTML
    assert "export-selected-csv" in INDEX_HTML
    assert "selectedRecentMatchExportKeys" in UI_JS
    assert "isRecentMatchExportMode" in UI_JS
    assert "function toggleRecentMatchExportMode" in UI_JS
    assert "function matchExportCheckbox" in UI_JS
    assert "function selectVisibleRecentMatchesForExport" in UI_JS
    assert "function clearRecentMatchExportSelection" in UI_JS
    assert "dataset.exportMatchKeys" in UI_JS


def test_dashboard_map_has_inset_and_tighter_fit_padding():
    styles = (ROOT / "ui" / "styles.css").read_text(encoding="utf-8")

    assert "--dashboard-map-inset: 8px;" in styles
    assert "padding: var(--dashboard-map-inset);" in styles
    assert "border-radius: 6px;" in styles
    assert "overflow: hidden;" in styles
    assert "const DASHBOARD_MAP_FIT_PADDING_PX = 18;" in UI_JS
    assert "const SELECTED_MATCH_FIT_PADDING_PX = 30;" in UI_JS
    assert "padding: [DASHBOARD_MAP_FIT_PADDING_PX, DASHBOARD_MAP_FIT_PADDING_PX]" in UI_JS
    assert "padding: [SELECTED_MATCH_FIT_PADDING_PX, SELECTED_MATCH_FIT_PADDING_PX]" in UI_JS


def test_source_health_controls_are_available():
    assert "worker-source-health" in INDEX_HTML
    assert "source-health-trends-open" in INDEX_HTML
    assert "source-health-trend-retention-hours" in INDEX_HTML
    assert "source-health-trend-modal" in INDEX_HTML
    assert "source-health-trend-list" in INDEX_HTML
    for field_id in [
        "source-health-status",
        "source-health-provider",
        "source-health-query",
        "source-health-last-success",
        "source-health-last-failure",
        "source-health-backoff",
        "source-health-retry-at",
        "source-health-aircraft-count",
        "source-health-last-error",
    ]:
        assert field_id in INDEX_HTML
    assert "function renderSourceHealth" in UI_JS
    assert "function normalizedSourceHealth" in UI_JS
    assert "function openSourceHealthTrendModal" in UI_JS
    assert "function sourceHealthTrendItem" in UI_JS
    assert "source_health_trends" in UI_JS
    assert "source_health_trend_retention_hours" in UI_JS
    assert "source_health" in UI_JS


def test_dashboard_repeat_alert_grouping_helpers_are_available():
    assert "function groupRecentMatches" in UI_JS
    assert "function renderRecentMatchGroup" in UI_JS
    assert "function toggleMatchGroup" in UI_JS
    assert "expandedMatchGroupKeys" in UI_JS
    assert "match-group-toggle" in UI_JS
    assert "match-count" in UI_JS


def test_ui_bootstrap_helpers_are_defined():
    for helper in [
        "normalizeConfig",
        "cloneConfig",
        "normalizeRuleNotificationProviders",
        "selectExistingRuleId",
    ]:
        assert f"function {helper}" in UI_JS
