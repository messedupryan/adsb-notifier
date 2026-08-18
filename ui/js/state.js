let config = null;
let savedConfig = null;
let isDirty = false;
let isJsonDirty = false;
let selectedRuleId = null;
let activeTab = "dashboard";
const uiVersion = "0.0.15";
const redactedSecret = "********";
const notificationProviderOrder = ["pushover", "email", "twilio"];
const adsbSourceProviders = ["adsb_lol", "airplanes_live", "direct"];
const adsbSourceQueries = ["point", "mil", "reg", "type", "hex"];
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

const fields = {
  adsbUrl: document.querySelector("#adsb-url"),
  adsbSourceProvider: document.querySelector("#adsb-source-provider"),
  adsbSourceQuery: document.querySelector("#adsb-source-query"),
  adsbSourceRadius: document.querySelector("#adsb-source-radius"),
  adsbSourceValue: document.querySelector("#adsb-source-value"),
  adsbSourceBaseUrl: document.querySelector("#adsb-source-base-url"),
  homeLat: document.querySelector("#home-lat"),
  homeLon: document.querySelector("#home-lon"),
  pollSeconds: document.querySelector("#poll-seconds"),
  staleAircraftSeconds: document.querySelector("#stale-aircraft-seconds"),
  recentMatchesWindowHours: document.querySelector("#recent-matches-window-hours"),
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
const newRuleType = document.querySelector("#new-rule-type");
const addRuleButton = document.querySelector("#add-rule");
const testRuleButton = document.querySelector("#test-rule");
const duplicateRuleButton = document.querySelector("#duplicate-rule");
const deleteRuleButton = document.querySelector("#delete-rule");
const testEmailButton = document.querySelector("#test-email");
const testPushoverButton = document.querySelector("#test-pushover");
const testTwilioButton = document.querySelector("#test-twilio");
const refreshStatusButton = document.querySelector("#refresh-status");
const workerStatusValue = document.querySelector("#worker-status-value");
const workerLastPoll = document.querySelector("#worker-last-poll");
const workerAircraftCount = document.querySelector("#worker-aircraft-count");
const workerNotificationCount = document.querySelector("#worker-notification-count");
const workerAdsbSource = document.querySelector("#worker-adsb-source");
const workerSourceErrors = document.querySelector("#worker-source-errors");
const workerRateLimitRetry = document.querySelector("#worker-rate-limit-retry");
const workerLastError = document.querySelector("#worker-last-error");
const recentMatches = document.querySelector("#recent-matches");
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
const themeMode = document.querySelector("#theme-mode");
const themeAccent = document.querySelector("#theme-accent");
const appLogo = document.querySelector("#app-logo");
const footerIcon = document.querySelector("#footer-icon");
const favicon = document.querySelector("#favicon");
const appleTouchIcon = document.querySelector("#apple-touch-icon");
