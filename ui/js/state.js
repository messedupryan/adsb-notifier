let config = null;
let savedConfig = null;
let isDirty = false;
let isJsonDirty = false;
let selectedRuleId = null;
let selectedRuleIds = new Set();
let activeTab = "dashboard";
let selectedNotificationProvider = null;
let emailHtmlPreviewMode = "rendered";
const uiVersion = "0.2.11";
const redactedSecret = "********";
const notificationProviderOrder = ["pushover", "email", "twilio"];
const adsbSourceProviders = ["adsb_lol", "airplanes_live", "local_receiver", "direct"];
const backupAdsbSourceProviders = ["local_receiver", "adsb_lol", "airplanes_live"];
const adsbSourceQueries = ["point", "mil", "reg", "type", "hex", "url", "file"];
const apiBase = new URLSearchParams(window.location.search).get("api") || "/api";
const assetVersion = `v=${uiVersion}`;
const themeStorageKey = "adsb-notifier-theme";
const defaultTheme = {mode: "light", accent: "teal"};
const themeAssets = {
  amber: {logo: `/images/logo_amber.png?${assetVersion}`, icon: `/images/icon_amber.png?${assetVersion}`},
  blue: {logo: `/images/logo_blue.png?${assetVersion}`, icon: `/images/icon_blue.png?${assetVersion}`},
  rose: {logo: `/images/logo_rose.png?${assetVersion}`, icon: `/images/icon_rose.png?${assetVersion}`},
  teal: {logo: `/images/logo_teal.png?${assetVersion}`, icon: `/images/icon_teal.png?${assetVersion}`},
  violet: {logo: `/images/logo_violet.png?${assetVersion}`, icon: `/images/icon_violet.png?${assetVersion}`},
};
let confirmResolver = null;
let confirmReturnFocus = null;
let latestWorkerStatus = null;
let dashboardMap = null;
let dashboardMapLayers = null;
let selectedRecentMatchKey = null;
let selectedRecentMatchExportKeys = new Set();
let isRecentMatchExportMode = false;
let expandedMatchGroupKeys = new Set();
let filteredRecentMatches = [];
let isSourceHealthTrendEventListVisible = false;
let sourceHealthTrendWindowHours = 24;

const fields = {
  adsbUrl: document.querySelector("#adsb-url"),
  adsbSourceProvider: document.querySelector("#adsb-source-provider"),
  adsbSourceQuery: document.querySelector("#adsb-source-query"),
  adsbSourceRadius: document.querySelector("#adsb-source-radius"),
  adsbSourceValue: document.querySelector("#adsb-source-value"),
  adsbSourceBaseUrl: document.querySelector("#adsb-source-base-url"),
  backupSourceEnabled: document.querySelector("#backup-source-enabled"),
  backupSourceProvider: document.querySelector("#backup-source-provider"),
  backupSourceQuery: document.querySelector("#backup-source-query"),
  backupSourceRadius: document.querySelector("#backup-source-radius"),
  backupSourceValue: document.querySelector("#backup-source-value"),
  backupSourceBaseUrl: document.querySelector("#backup-source-base-url"),
  homeLat: document.querySelector("#home-lat"),
  homeLon: document.querySelector("#home-lon"),
  pollSeconds: document.querySelector("#poll-seconds"),
  primaryRetryMinutes: document.querySelector("#primary-retry-minutes"),
  staleAircraftSeconds: document.querySelector("#stale-aircraft-seconds"),
  recentMatchesWindowHours: document.querySelector("#recent-matches-window-hours"),
  sourceHealthTrendRetentionHours: document.querySelector("#source-health-trend-retention-hours"),
  globalExclusionTailNumbers: document.querySelector("#global-exclusion-tail-numbers"),
  globalExclusionHexIds: document.querySelector("#global-exclusion-hex-ids"),
  globalExclusionCallsigns: document.querySelector("#global-exclusion-callsigns"),
  globalExclusionAircraftTypes: document.querySelector("#global-exclusion-aircraft-types"),
  globalExclusionCategories: document.querySelector("#global-exclusion-categories"),
  emailEnabled: document.querySelector("#email-enabled"),
  emailSmtpHost: document.querySelector("#email-smtp-host"),
  emailSmtpPort: document.querySelector("#email-smtp-port"),
  emailStarttls: document.querySelector("#email-starttls"),
  emailUsername: document.querySelector("#email-username"),
  emailPassword: document.querySelector("#email-password"),
  emailFrom: document.querySelector("#email-from"),
  emailTo: document.querySelector("#email-to"),
  emailHtmlEnabled: document.querySelector("#email-html-enabled"),
  emailBrandTheme: document.querySelector("#email-brand-theme"),
  emailIncludeBrandImages: document.querySelector("#email-include-brand-images"),
  emailIncludeMapSnapshot: document.querySelector("#email-include-map-snapshot"),
  emailSubjectTemplate: document.querySelector("#email-subject-template"),
  emailBodyTemplate: document.querySelector("#email-body-template"),
  emailHtmlBodyTemplate: document.querySelector("#email-html-body-template"),
  pushoverEnabled: document.querySelector("#pushover-enabled"),
  pushoverAppToken: document.querySelector("#pushover-app-token"),
  pushoverUserKey: document.querySelector("#pushover-user-key"),
  pushoverDevice: document.querySelector("#pushover-device"),
  pushoverPriority: document.querySelector("#pushover-priority"),
  pushoverSound: document.querySelector("#pushover-sound"),
  pushoverTitleTemplate: document.querySelector("#pushover-title-template"),
  pushoverUrlTemplate: document.querySelector("#pushover-url-template"),
  pushoverUrlTitleTemplate: document.querySelector("#pushover-url-title-template"),
  pushoverMessageTemplate: document.querySelector("#pushover-message-template"),
  twilioEnabled: document.querySelector("#twilio-enabled"),
  twilioAccountSid: document.querySelector("#twilio-account-sid"),
  twilioApiKeySid: document.querySelector("#twilio-api-key-sid"),
  twilioApiKeySecret: document.querySelector("#twilio-api-key-secret"),
  twilioFrom: document.querySelector("#twilio-from"),
  twilioTo: document.querySelector("#twilio-to"),
  twilioBodyTemplate: document.querySelector("#twilio-body-template"),
  ruleName: document.querySelector("#rule-name"),
  ruleEvent: document.querySelector("#rule-event"),
  ruleEnabled: document.querySelector("#rule-enabled"),
  ruleRadius: document.querySelector("#rule-radius"),
  ruleCooldown: document.querySelector("#rule-cooldown"),
  ruleMinAltitude: document.querySelector("#rule-min-altitude"),
  ruleMaxAltitude: document.querySelector("#rule-max-altitude"),
  ruleTailNumbers: document.querySelector("#rule-tail-numbers"),
  ruleAircraftTypes: document.querySelector("#rule-aircraft-types"),
  ruleCategories: document.querySelector("#rule-categories"),
  ruleSquawkCodes: document.querySelector("#rule-squawk-codes"),
  ruleNotificationProviders: document.querySelector("#rule-notification-providers"),
  ruleNotificationEmpty: document.querySelector("#rule-notification-empty"),
  ruleQuietEnabled: document.querySelector("#rule-quiet-enabled"),
  ruleQuietStart: document.querySelector("#rule-quiet-start"),
  ruleQuietEnd: document.querySelector("#rule-quiet-end"),
  ruleQuietTimeZone: document.querySelector("#rule-quiet-time-zone"),
  ruleExclusionTailNumbers: document.querySelector("#rule-exclusion-tail-numbers"),
  ruleExclusionHexIds: document.querySelector("#rule-exclusion-hex-ids"),
  ruleExclusionCallsigns: document.querySelector("#rule-exclusion-callsigns"),
  ruleExclusionAircraftTypes: document.querySelector("#rule-exclusion-aircraft-types"),
  ruleExclusionCategories: document.querySelector("#rule-exclusion-categories"),
  ruleMilitary: document.querySelector("#rule-military"),
  ruleIncludeTisb: document.querySelector("#rule-include-tisb"),
  ruleHeadingChange: document.querySelector("#rule-heading-change"),
  ruleWindowMinutes: document.querySelector("#rule-window-minutes"),
  json: document.querySelector("#config-json"),
};

const statusLabel = document.querySelector("#status");
const messagePanel = document.querySelector("#message-panel");
const versionLabel = document.querySelector("#ui-version");
const reloadButton = document.querySelector("#reload");
const discardButton = document.querySelector("#discard");
const saveButton = document.querySelector("#save");
const ruleList = document.querySelector("#rule-list");
const ruleSearch = document.querySelector("#rule-search");
const ruleTypeFilter = document.querySelector("#rule-type-filter");
const ruleStateFilter = document.querySelector("#rule-state-filter");
const ruleSelectedCount = document.querySelector("#rule-selected-count");
const toggleVisibleRulesButton = document.querySelector("#toggle-visible-rules");
const bulkEnableRulesButton = document.querySelector("#bulk-enable-rules");
const bulkDisableRulesButton = document.querySelector("#bulk-disable-rules");
const newRuleType = document.querySelector("#new-rule-type");
const addRuleButton = document.querySelector("#add-rule");
const testRuleButton = document.querySelector("#test-rule");
const duplicateRuleButton = document.querySelector("#duplicate-rule");
const deleteRuleButton = document.querySelector("#delete-rule");
const testEmailButton = document.querySelector("#test-email");
const testPushoverButton = document.querySelector("#test-pushover");
const testTwilioButton = document.querySelector("#test-twilio");
const notificationProviderSelector = document.querySelector("#notification-provider-selector");
const notificationPreview = document.querySelector("#notification-preview");
const notificationPreviewSource = document.querySelector("#notification-preview-source");
const refreshStatusButton = document.querySelector("#refresh-status");
const workerStatusValue = document.querySelector("#worker-status-value");
const workerLastPoll = document.querySelector("#worker-last-poll");
const workerAircraftCount = document.querySelector("#worker-aircraft-count");
const workerNotificationCount = document.querySelector("#worker-notification-count");
const workerAdsbSource = document.querySelector("#worker-adsb-source");
const workerSourceHealth = document.querySelector("#worker-source-health");
const workerSourceErrors = document.querySelector("#worker-source-errors");
const workerRateLimitRetry = document.querySelector("#worker-rate-limit-retry");
const workerLastError = document.querySelector("#worker-last-error");
const sourceHealthStatus = document.querySelector("#source-health-status");
const sourceHealthProvider = document.querySelector("#source-health-provider");
const sourceHealthQuery = document.querySelector("#source-health-query");
const sourceHealthLastSuccess = document.querySelector("#source-health-last-success");
const sourceHealthLastFailure = document.querySelector("#source-health-last-failure");
const sourceHealthBackoff = document.querySelector("#source-health-backoff");
const sourceHealthRetryAt = document.querySelector("#source-health-retry-at");
const sourceHealthAircraftCount = document.querySelector("#source-health-aircraft-count");
const sourceHealthLastError = document.querySelector("#source-health-last-error");
const sourceHealthTrendsOpenButton = document.querySelector("#source-health-trends-open");
const sourceHealthTrendModal = document.querySelector("#source-health-trend-modal");
const sourceHealthTrendCloseButton = document.querySelector("#source-health-trend-close");
const sourceHealthTrendSummary = document.querySelector("#source-health-trend-summary");
const sourceHealthTrendWindow = document.querySelector("#source-health-trend-window");
const sourceHealthTrendChart = document.querySelector("#source-health-trend-chart");
const sourceHealthTrendEventsToggle = document.querySelector("#source-health-trend-events-toggle");
const sourceHealthTrendList = document.querySelector("#source-health-trend-list");
const recentMatches = document.querySelector("#recent-matches");
const toggleRecentExportButton = document.querySelector("#toggle-recent-export");
const recentExportActions = document.querySelector("#recent-export-actions");
const recentExportSelectedCount = document.querySelector("#recent-export-selected-count");
const selectVisibleMatchesButton = document.querySelector("#select-visible-matches");
const clearSelectedMatchesButton = document.querySelector("#clear-selected-matches");
const exportSelectedJson = document.querySelector("#export-selected-json");
const exportSelectedCsv = document.querySelector("#export-selected-csv");
const dashboardEventFilter = document.querySelector("#dashboard-event-filter");
const dashboardRuleFilter = document.querySelector("#dashboard-rule-filter");
const dashboardProviderFilter = document.querySelector("#dashboard-provider-filter");
const dashboardStatusFilter = document.querySelector("#dashboard-status-filter");
const dashboardSearch = document.querySelector("#dashboard-search");
const alertMap = document.querySelector("#alert-map");
const alertMapEmpty = document.querySelector("#alert-map-empty");
const recenterMapButton = document.querySelector("#recenter-map");
const fitMapButton = document.querySelector("#fit-map");
const selectedMapButton = document.querySelector("#selected-map");
const ruleForm = document.querySelector("#rule-form");
const ruleEmpty = document.querySelector("#rule-empty");
const ruleEditorTitle = document.querySelector("#rule-editor-title");
const confirmModal = document.querySelector("#confirm-modal");
const confirmTitle = document.querySelector("#confirm-title");
const confirmMessage = document.querySelector("#confirm-message");
const confirmCancelButton = document.querySelector("#confirm-cancel");
const confirmAcceptButton = document.querySelector("#confirm-accept");
const matchDetailModal = document.querySelector("#match-detail-modal");
const matchDetailTitle = document.querySelector("#match-detail-title");
const matchDetailLink = document.querySelector("#match-detail-link");
const matchDetailExportJson = document.querySelector("#match-detail-export-json");
const matchDetailExportCsv = document.querySelector("#match-detail-export-csv");
const matchDetailCloseButton = document.querySelector("#match-detail-close");
const matchDetailSummary = document.querySelector("#match-detail-summary");
const matchDetailPayload = document.querySelector("#match-detail-payload");
const themeMode = document.querySelector("#theme-mode");
const themeAccent = document.querySelector("#theme-accent");
const appLogo = document.querySelector("#app-logo");
const footerIcon = document.querySelector("#footer-icon");
const favicon = document.querySelector("#favicon");
const appleTouchIcon = document.querySelector("#apple-touch-icon");
