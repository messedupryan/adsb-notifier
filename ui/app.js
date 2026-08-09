let config = null;
let savedConfig = null;
let isDirty = false;
let selectedRuleId = null;
let activeTab = "dashboard";
const uiVersion = "20260808-14";
const notificationProviderOrder = ["pushover", "email", "webhook", "twilio"];
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

const fields = {
  adsbUrl: document.querySelector("#adsb-url"),
  homeLat: document.querySelector("#home-lat"),
  homeLon: document.querySelector("#home-lon"),
  pollSeconds: document.querySelector("#poll-seconds"),
  staleAircraftSeconds: document.querySelector("#stale-aircraft-seconds"),
  emailEnabled: document.querySelector("#email-enabled"),
  emailSmtpHost: document.querySelector("#email-smtp-host"),
  emailSmtpPort: document.querySelector("#email-smtp-port"),
  emailStarttls: document.querySelector("#email-starttls"),
  emailUsername: document.querySelector("#email-username"),
  emailPassword: document.querySelector("#email-password"),
  emailFrom: document.querySelector("#email-from"),
  emailTo: document.querySelector("#email-to"),
  emailSubjectTemplate: document.querySelector("#email-subject-template"),
  emailBodyTemplate: document.querySelector("#email-body-template"),
  pushoverEnabled: document.querySelector("#pushover-enabled"),
  pushoverAppToken: document.querySelector("#pushover-app-token"),
  pushoverUserKey: document.querySelector("#pushover-user-key"),
  pushoverDevice: document.querySelector("#pushover-device"),
  pushoverPriority: document.querySelector("#pushover-priority"),
  pushoverSound: document.querySelector("#pushover-sound"),
  pushoverTitleTemplate: document.querySelector("#pushover-title-template"),
  pushoverMessageTemplate: document.querySelector("#pushover-message-template"),
  twilioEnabled: document.querySelector("#twilio-enabled"),
  twilioAccountSid: document.querySelector("#twilio-account-sid"),
  twilioApiKeySid: document.querySelector("#twilio-api-key-sid"),
  twilioApiKeySecret: document.querySelector("#twilio-api-key-secret"),
  twilioFrom: document.querySelector("#twilio-from"),
  twilioTo: document.querySelector("#twilio-to"),
  twilioBodyTemplate: document.querySelector("#twilio-body-template"),
  webhookEnabled: document.querySelector("#webhook-enabled"),
  webhookUrl: document.querySelector("#webhook-url"),
  webhookMessageTemplate: document.querySelector("#webhook-message-template"),
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
  ruleNotificationProviders: document.querySelector("#rule-notification-providers"),
  ruleNotificationEmpty: document.querySelector("#rule-notification-empty"),
  ruleMilitary: document.querySelector("#rule-military"),
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
const testWebhookButton = document.querySelector("#test-webhook");
const refreshStatusButton = document.querySelector("#refresh-status");
const workerStatusValue = document.querySelector("#worker-status-value");
const workerLastPoll = document.querySelector("#worker-last-poll");
const workerAircraftCount = document.querySelector("#worker-aircraft-count");
const workerNotificationCount = document.querySelector("#worker-notification-count");
const workerAdsbSource = document.querySelector("#worker-adsb-source");
const workerLastError = document.querySelector("#worker-last-error");
const recentMatches = document.querySelector("#recent-matches");
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

versionLabel.textContent = `UI ${uiVersion}`;
initThemeControls();

document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => requestTabChange(tab.dataset.tab));
});
reloadButton.addEventListener("click", loadConfig);
discardButton.addEventListener("click", () => discardChanges());
saveButton.addEventListener("click", () => saveConfig());
addRuleButton.addEventListener("click", addRule);
testRuleButton.addEventListener("click", testSelectedRule);
duplicateRuleButton.addEventListener("click", duplicateSelectedRule);
deleteRuleButton.addEventListener("click", deleteSelectedRule);
testEmailButton.addEventListener("click", () => testNotification("email"));
testPushoverButton.addEventListener("click", () => testNotification("pushover"));
testTwilioButton.addEventListener("click", () => testNotification("twilio"));
testWebhookButton.addEventListener("click", () => testNotification("webhook"));
refreshStatusButton.addEventListener("click", () => loadWorkerStatus());
fields.ruleNotificationProviders.addEventListener("change", handleInput);
ruleList.addEventListener("click", async (event) => {
  const item = event.target.closest(".rule-item");
  if (!item) return;
  const nextRuleId = item.dataset.ruleId;
  if (!nextRuleId) return;
  if (nextRuleId === selectedRuleId) return;
  if (isDirty && activeTab === "rules") {
    const shouldDiscard = await confirmAction({
      title: "Discard rule edits?",
      message: "Switching rules will discard unsaved changes to the current rule.",
      acceptLabel: "Discard",
      destructive: true,
    });
    if (!shouldDiscard) return;
    config = cloneConfig(savedConfig);
    selectedRuleId = selectExistingRuleId(nextRuleId);
    setDirty(false);
    clearMessage();
    renderAll();
    return;
  }
  if (!commitCurrentView()) return;
  selectedRuleId = nextRuleId;
  renderRuleList();
  renderRuleEditor();
  renderJson();
});

document.querySelectorAll("input, select, textarea").forEach((input) => {
  if (input.dataset.themeControl) return;
  input.addEventListener("input", handleInput);
  input.addEventListener("change", handleInput);
});
window.addEventListener("beforeunload", (event) => {
  if (!isDirty) return;
  event.preventDefault();
  event.returnValue = "";
});
confirmCancelButton.addEventListener("click", () => closeConfirm(false));
confirmAcceptButton.addEventListener("click", () => closeConfirm(true));
confirmModal.addEventListener("click", (event) => {
  if (event.target === confirmModal) closeConfirm(false);
});
window.addEventListener("keydown", (event) => {
  if (confirmModal.classList.contains("hidden")) return;
  if (event.key === "Escape") closeConfirm(false);
});
window.addEventListener("error", (event) => {
  showErrors([`UI error: ${event.message}`]);
});
window.addEventListener("unhandledrejection", (event) => {
  showErrors([`UI error: ${event.reason?.message || event.reason || "Unhandled promise rejection"}`]);
});

loadConfig();
loadWorkerStatus();

function initThemeControls() {
  const theme = readThemePreference();
  themeMode.value = theme.mode;
  themeAccent.value = theme.accent;
  applyTheme(theme);
  themeMode.addEventListener("change", () => saveThemePreference({mode: themeMode.value, accent: themeAccent.value}));
  themeAccent.addEventListener("change", () => saveThemePreference({mode: themeMode.value, accent: themeAccent.value}));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themeMode.value === "system") {
      applyTheme({mode: "system", accent: themeAccent.value});
    }
  });
}

function readThemePreference() {
  try {
    return {...defaultTheme, ...JSON.parse(localStorage.getItem(themeStorageKey) || "{}")};
  } catch {
    return {...defaultTheme};
  }
}

function saveThemePreference(theme) {
  const nextTheme = {
    mode: ["light", "dark", "system"].includes(theme.mode) ? theme.mode : defaultTheme.mode,
    accent: ["teal", "blue", "amber", "rose", "violet"].includes(theme.accent) ? theme.accent : defaultTheme.accent,
  };
  localStorage.setItem(themeStorageKey, JSON.stringify(nextTheme));
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  const resolvedMode =
    theme.mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme.mode === "dark" ? "dark" : "light";
  document.documentElement.dataset.mode = resolvedMode;
  document.documentElement.dataset.themeMode = theme.mode;
  document.documentElement.dataset.accent = theme.accent;
  const assets = themeAssets[theme.accent] || themeAssets.teal;
  appLogo.src = assets.logo;
  footerIcon.src = assets.icon;
}

async function loadConfig() {
  if (
    isDirty &&
    !(await confirmAction({
      title: "Reload configuration?",
      message: "Reloading will discard unsaved changes and fetch the saved configuration from the API.",
      acceptLabel: "Reload",
      destructive: true,
    }))
  ) {
    return;
  }
  setBusy(true);
  try {
    const response = await fetch(`${apiBase}/config`);
    const payload = await response.json();
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load configuration");
    }
    savedConfig = normalizeConfig(payload);
    config = cloneConfig(savedConfig);
    selectedRuleId = selectExistingRuleId(selectedRuleId);
    setDirty(false);
    renderAll();
    setStatus("Configuration loaded");
    clearMessage();
  } catch (error) {
    showErrors([error.message || "Unable to load configuration"]);
  } finally {
    setBusy(false);
  }
}

async function saveConfig(options = {}) {
  if (!config) return false;

  if (!commitCurrentView()) return false;
  const selectedRuleName = getSelectedRule()?.name || "selected rule";

  const errors = validateConfig(config);
  if (errors.length > 0) {
    showErrors(errors);
    return false;
  }

  clearMessage();
  setStatus("Saving configuration...");
  setBusy(true);
  try {
    const selectedRule = getSelectedRule();
    const response =
      activeTab === "rules" && selectedRule
        ? await fetch(`${apiBase}/rules/${encodeURIComponent(selectedRule.id)}`, {
            method: "PUT",
            headers: writeHeaders(),
            body: JSON.stringify(selectedRule),
          })
        : await fetch(`${apiBase}/config`, {
            method: "PUT",
            headers: writeHeaders(),
            body: JSON.stringify(config),
          });
    const saved = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(saved.error || "Unable to save configuration");
    }
    if (activeTab === "rules" && selectedRule) {
      const index = selectedRuleIndex();
      config.rules[index] = saved.rule;
      config.config_revision = saved.config_revision;
    } else {
      config = normalizeConfig(saved);
    }
    savedConfig = cloneConfig(config);
    selectedRuleId = selectExistingRuleId(selectedRuleId);
    setDirty(false);
    renderAll();
    const successMessage = options.successMessage || (activeTab === "rules" ? `Saved rule: ${selectedRuleName}` : "Configuration saved");
    setStatus(successMessage);
    if (!options.quiet) showSuccess(successMessage);
    return true;
  } catch (error) {
    showErrors([error.message || "Unable to save configuration"]);
    return false;
  } finally {
    setBusy(false);
  }
}

function handleInput(event) {
  if (!config) return;
  if (event.target === newRuleType) return;
  if (event.target === fields.json) {
    setDirty(true);
    clearMessage();
    return;
  }

  if (event.target === fields.ruleEvent) {
    syncSelectedRuleFromForms();
    renderRuleEditor();
    renderRuleList();
    renderJson();
  } else if (
    event.target === fields.ruleName ||
    event.target === fields.ruleEnabled ||
    event.target === fields.ruleRadius ||
    event.target === fields.ruleCooldown
  ) {
    syncSelectedRuleFromForms();
    renderRuleList();
    renderJson();
  }
  setDirty(true);
  clearMessage();
}

async function requestTabChange(tabName) {
  if (!tabName || tabName === activeTab) return;
  if (isDirty) {
    const shouldSave = await confirmAction({
      title: "Save changes?",
      message: "Save your unsaved changes before switching tabs.",
      acceptLabel: "Save",
    });
    if (!shouldSave) return;
    const saved = await saveConfig({successMessage: "Saved changes before switching tabs", quiet: true});
    if (!saved) return;
  }
  activateTab(tabName);
}

function activateTab(tabName) {
  const previousTab = activeTab;
  activeTab = tabName;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabName);
  });
  if (tabName === "json") {
    commitForms();
    renderJson();
  } else if (tabName === "dashboard") {
    loadWorkerStatus();
  } else if (previousTab === "json" && fields.json.value.trim()) {
    if (syncFromJson()) {
      renderForms();
      renderRuleList();
    }
  }
}

function renderAll() {
  renderForms();
  renderRuleList();
  renderRuleEditor();
  renderJson();
}

async function loadWorkerStatus() {
  try {
    const response = await fetch(`${apiBase}/status`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load worker status");
    }
    renderWorkerStatus(payload);
  } catch (error) {
    renderWorkerStatus({status: "error", last_error: error.message || "Unable to load worker status", recent_matches: []});
  }
}

function renderWorkerStatus(status) {
  workerStatusValue.textContent = status.status || "unknown";
  workerLastPoll.textContent = formatDateTime(status.last_poll_at) || "Never";
  workerAircraftCount.textContent = status.aircraft_count ?? "0";
  workerNotificationCount.textContent = status.notification_count ?? "0";
  workerAdsbSource.textContent = status.adsb_url || "Unknown";
  workerLastError.textContent = status.last_error || "None";

  recentMatches.replaceChildren();
  const matches = Array.isArray(status.recent_matches) ? status.recent_matches : [];
  if (matches.length === 0) {
    recentMatches.append(emptyState("No recent matches"));
    return;
  }
  matches.slice(0, 10).forEach((match) => {
    const item = document.createElement("div");
    item.className = "match-item";
    const title = document.createElement("strong");
    title.textContent = `${match.rule_name || "Rule"}: ${match.aircraft_label || match.hex || "Aircraft"}`;
    const meta = document.createElement("span");
    const type = match.aircraft_type || "unknown type";
    const distance = match.distance_miles ?? "unknown";
    const altitude = match.altitude_ft === null || match.altitude_ft === undefined ? "unknown altitude" : `${match.altitude_ft} ft`;
    meta.textContent = `${type} · ${distance} mi · ${altitude}`;
    item.append(title, meta);
    recentMatches.append(item);
  });
}

function renderForms() {
  if (!config) return;
  const notifications = config.notifications || {};
  const email = notifications.email || {};
  const pushover = notifications.pushover || {};
  const twilio = notifications.twilio || {};
  const webhook = notifications.webhook || {};

  fields.adsbUrl.value = config.adsb_url || "";
  fields.homeLat.value = config.home?.lat ?? "";
  fields.homeLon.value = config.home?.lon ?? "";
  fields.pollSeconds.value = config.poll_seconds ?? 30;
  fields.staleAircraftSeconds.value = config.stale_aircraft_seconds ?? 90;

  fields.emailEnabled.checked = Boolean(email.enabled);
  fields.emailSmtpHost.value = email.smtp_host || "";
  fields.emailSmtpPort.value = email.smtp_port ?? 587;
  fields.emailStarttls.checked = email.starttls !== false;
  fields.emailUsername.value = email.username || "";
  fields.emailPassword.value = email.password || "";
  fields.emailFrom.value = email.from || "";
  fields.emailTo.value = listToText(email.to);
  fields.emailSubjectTemplate.value = email.subject_template || "";
  fields.emailBodyTemplate.value = email.body_template || "";

  fields.pushoverEnabled.checked = Boolean(pushover.enabled);
  fields.pushoverAppToken.value = pushover.app_token || "";
  fields.pushoverUserKey.value = pushover.user_key || "";
  fields.pushoverDevice.value = pushover.device || "";
  fields.pushoverPriority.value = pushover.priority ?? "";
  fields.pushoverSound.value = pushover.sound || "";
  fields.pushoverTitleTemplate.value = pushover.title_template || pushover.title || "";
  fields.pushoverMessageTemplate.value = pushover.message_template || pushover.body_template || pushover.template || "";

  fields.twilioEnabled.checked = Boolean(twilio.enabled);
  fields.twilioAccountSid.value = twilio.account_sid || "";
  fields.twilioApiKeySid.value = twilio.api_key_sid || "";
  fields.twilioApiKeySecret.value = twilio.api_key_secret || "";
  fields.twilioFrom.value = twilio.from || "";
  fields.twilioTo.value = twilio.to || "";
  fields.twilioBodyTemplate.value = twilio.body_template || twilio.message_template || twilio.template || "";

  fields.webhookEnabled.checked = Boolean(webhook.enabled);
  fields.webhookUrl.value = webhook.url || "";
  fields.webhookMessageTemplate.value = webhook.message_template || webhook.body_template || webhook.template || "";
  renderRuleEditor();
}

function renderRuleList() {
  ruleList.replaceChildren();
  const rules = config?.rules || [];
  if (rules.length === 0) {
    ruleList.append(emptyState("No rules configured"));
    return;
  }

  rules.forEach((rule) => {
    const button = document.createElement("button");
    button.className = "rule-item";
    button.type = "button";
    button.dataset.ruleId = rule.id;
    button.classList.toggle("selected", rule.id === selectedRuleId);
    button.classList.toggle("disabled", rule.enabled === false);

    const title = document.createElement("strong");
    const status = document.createElement("span");
    status.className = "rule-status";
    status.textContent = rule.enabled === false ? "Disabled" : "Enabled";
    title.append(status, document.createTextNode(rule.name || "Unnamed rule"));
    const meta = document.createElement("span");
    meta.textContent = `${eventLabel(rule.event)} · ${ruleSummary(rule)} · ${rule.radius_miles ?? "unset"} mi`;
    button.append(title, meta);
    ruleList.append(button);
  });
}

function renderRuleEditor() {
  const rule = getSelectedRule();
  const hasRule = Boolean(rule);
  ruleForm.classList.toggle("hidden", !hasRule);
  ruleEmpty.classList.toggle("hidden", hasRule);
  testRuleButton.disabled = !hasRule;
  deleteRuleButton.disabled = !hasRule;
  duplicateRuleButton.disabled = !hasRule;
  ruleEditorTitle.textContent = hasRule ? "Rule Details" : "Rule Details";
  if (!rule) return;

  fields.ruleName.value = rule.name || "";
  fields.ruleEvent.value = rule.event || "tail";
  fields.ruleEnabled.checked = rule.enabled !== false;
  fields.ruleRadius.value = rule.radius_miles ?? "";
  fields.ruleCooldown.value = rule.cooldown_minutes ?? 30;
  fields.ruleMinAltitude.value = rule.min_altitude_ft ?? "";
  fields.ruleMaxAltitude.value = rule.max_altitude_ft ?? "";
  fields.ruleTailNumbers.value = listToText(rule.tail_numbers);
  fields.ruleAircraftTypes.value = listToText(rule.aircraft_types);
  fields.ruleCategories.value = listToText(rule.categories);
  fields.ruleMilitary.checked = rule.military !== false;
  fields.ruleHeadingChange.value = rule.circling_min_heading_change_deg ?? 270;
  fields.ruleWindowMinutes.value = rule.circling_window_minutes ?? 8;
  renderRuleNotificationProviders(rule);
  updateRuleFieldVisibility(rule.event || "tail");
}

function renderRuleNotificationProviders(rule) {
  const available = enabledNotificationProviders();
  const selected = new Set(Array.isArray(rule.notification_providers) ? rule.notification_providers : available);
  fields.ruleNotificationProviders.replaceChildren();
  fields.ruleNotificationEmpty.classList.toggle("hidden", available.length > 0);
  available.forEach((provider) => {
    const label = document.createElement("label");
    label.className = "switch";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = provider;
    input.checked = selected.has(provider);
    label.append(input, document.createTextNode(providerLabel(provider)));
    fields.ruleNotificationProviders.append(label);
  });
}

function renderJson() {
  if (!config) return;
  fields.json.value = JSON.stringify(config, null, 2);
}

function syncFromForms() {
  if (!config) return;
  config.adsb_url = fields.adsbUrl.value.trim();
  config.home = {
    lat: numberValue(fields.homeLat),
    lon: numberValue(fields.homeLon),
  };
  config.poll_seconds = integerValue(fields.pollSeconds, 30);
  config.stale_aircraft_seconds = integerValue(fields.staleAircraftSeconds, 90);
  const notifications = config.notifications || {};
  const existingEmail = notifications.email || {};
  const existingPushover = notifications.pushover || {};
  const existingTwilio = notifications.twilio || {};
  const existingWebhook = notifications.webhook || {};
  config.notifications = {
    ...notifications,
    email: {
      ...existingEmail,
      enabled: fields.emailEnabled.checked,
      smtp_host: fields.emailSmtpHost.value.trim(),
      smtp_port: integerValue(fields.emailSmtpPort, 587),
      starttls: fields.emailStarttls.checked,
      username: fields.emailUsername.value.trim(),
      password: fields.emailPassword.value.trim(),
      from: fields.emailFrom.value.trim(),
      to: textToList(fields.emailTo.value),
      subject_template: fields.emailSubjectTemplate.value.trim(),
      body_template: fields.emailBodyTemplate.value.trim(),
    },
    pushover: {
      ...existingPushover,
      enabled: fields.pushoverEnabled.checked,
      app_token: fields.pushoverAppToken.value.trim(),
      user_key: fields.pushoverUserKey.value.trim(),
      device: fields.pushoverDevice.value.trim(),
      priority: optionalIntegerValue(fields.pushoverPriority),
      sound: fields.pushoverSound.value.trim(),
      title_template: fields.pushoverTitleTemplate.value.trim(),
      message_template: fields.pushoverMessageTemplate.value.trim(),
    },
    twilio: {
      ...existingTwilio,
      enabled: fields.twilioEnabled.checked,
      account_sid: fields.twilioAccountSid.value.trim(),
      api_key_sid: fields.twilioApiKeySid.value.trim(),
      api_key_secret: fields.twilioApiKeySecret.value.trim(),
      from: fields.twilioFrom.value.trim(),
      to: fields.twilioTo.value.trim(),
      body_template: fields.twilioBodyTemplate.value.trim(),
    },
    webhook: {
      ...existingWebhook,
      enabled: fields.webhookEnabled.checked,
      url: fields.webhookUrl.value.trim(),
      message_template: fields.webhookMessageTemplate.value.trim(),
    },
  };
  syncSelectedRuleFromForms();
  normalizeRuleNotificationProviders(config);
}

function syncSelectedRuleFromForms() {
  if (!config) return;
  const rule = getSelectedRule();
  if (rule) {
    rule.name = fields.ruleName.value.trim();
    rule.event = fields.ruleEvent.value;
    rule.enabled = fields.ruleEnabled.checked;
    rule.radius_miles = numberValue(fields.ruleRadius);
    rule.cooldown_minutes = integerValue(fields.ruleCooldown);
    setOptionalNumber(rule, "min_altitude_ft", fields.ruleMinAltitude, true);
    setOptionalNumber(rule, "max_altitude_ft", fields.ruleMaxAltitude, true);
    rule.tail_numbers = textToList(fields.ruleTailNumbers.value);
    rule.aircraft_types = textToList(fields.ruleAircraftTypes.value);
    rule.categories = textToList(fields.ruleCategories.value);
    rule.notification_providers = selectedRuleNotificationProviders();
    rule.military = fields.ruleMilitary.checked;
    rule.circling_min_heading_change_deg = numberValue(fields.ruleHeadingChange);
    rule.circling_window_minutes = integerValue(fields.ruleWindowMinutes);
    pruneRuleForEvent(rule);
  }
}

function selectedRuleNotificationProviders() {
  const available = new Set(enabledNotificationProviders());
  return Array.from(fields.ruleNotificationProviders.querySelectorAll("input:checked"))
    .map((input) => input.value)
    .filter((provider) => available.has(provider));
}

function syncFromJson() {
  try {
    config = normalizeConfig(JSON.parse(fields.json.value));
    selectedRuleId = selectExistingRuleId(selectedRuleId);
    return true;
  } catch {
    showErrors(["JSON has a syntax error."]);
    return false;
  }
}

function addRule() {
  if (!config) return;
  if (!commitCurrentView()) return;
  createRuleOnServer(createRule(newRuleType.value), "Added rule");
}

function duplicateSelectedRule() {
  if (!config || !getSelectedRule()) return;
  if (!commitCurrentView()) return;
  const source = getSelectedRule();
  const clone = JSON.parse(JSON.stringify(source));
  delete clone.id;
  clone.name = uniqueRuleName(`${source.name || eventLabel(source.event)} copy`);
  createRuleOnServer(clone, "Duplicated rule");
}

async function deleteSelectedRule() {
  if (!config || !getSelectedRule()) return;
  if (!commitCurrentView()) return;
  const ruleName = getSelectedRule()?.name || "selected rule";
  if (
    !(await confirmAction({
      title: "Delete rule?",
      message: `Delete "${ruleName}" and save this change now?`,
      acceptLabel: "Delete",
      destructive: true,
    }))
  ) {
    return;
  }
  const ruleId = selectedRuleId;
  setBusy(true);
  try {
    const response = await fetch(`${apiBase}/rules/${encodeURIComponent(ruleId)}`, {
      method: "DELETE",
      headers: writeHeaders(),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Unable to delete rule");
    }
    config.rules = config.rules.filter((rule) => rule.id !== ruleId);
    config.config_revision = payload.config_revision ?? config.config_revision;
    savedConfig = cloneConfig(config);
    selectedRuleId = selectExistingRuleId(null);
    setDirty(false);
    renderAll();
    showSuccess(`Deleted rule: ${ruleName}`);
  } catch (error) {
    showErrors([error.message || "Unable to delete rule"]);
  } finally {
    setBusy(false);
  }
}

async function testSelectedRule() {
  if (!config || !getSelectedRule()) return;
  if (isDirty) {
    const shouldSave = await confirmAction({
      title: "Save before test?",
      message: "Save this rule before testing it against live ADS-B data.",
      acceptLabel: "Save",
    });
    if (!shouldSave) return;
    const saved = await saveConfig({successMessage: "Saved rule before test", quiet: true});
    if (!saved) return;
  }

  const rule = getSelectedRule();
  if (!rule) return;
  clearMessage();
  setStatus(`Testing ${rule.name || "selected rule"}...`);
  setBusy(true);
  try {
    const response = await fetch(`${apiBase}/rules/${encodeURIComponent(rule.id)}/test`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Unable to test rule");
    }
    if (!payload.matched) {
      showSuccess(`No live matches for ${payload.rule?.name || rule.name || "selected rule"}. No notifications sent.`);
      return;
    }
    const first = payload.matches?.[0];
    const aircraft = first ? `${first.aircraft_label} ${first.distance_miles} mi` : `${payload.match_count} match`;
    showSuccess(`Sent ${payload.sent_count} notification${payload.sent_count === 1 ? "" : "s"} for ${payload.rule?.name || rule.name}: ${aircraft}.`);
  } catch (error) {
    showErrors([error.message || "Unable to test rule"]);
  } finally {
    setBusy(false);
  }
}

async function testNotification(provider) {
  if (!config) return;
  if (isDirty) {
    const shouldSave = await confirmAction({
      title: "Save before test?",
      message: "Save your notification changes before sending a test message.",
      acceptLabel: "Save",
    });
    if (!shouldSave) return;
    const saved = await saveConfig({successMessage: "Saved changes before test", quiet: true});
    if (!saved) return;
  }

  clearMessage();
  setStatus(`Sending ${providerLabel(provider)} test...`);
  setBusy(true);
  try {
    const response = await fetch(`${apiBase}/notifications/test`, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({provider}),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || `Unable to send ${providerLabel(provider)} test`);
    }
    showSuccess(`Sent ${providerLabel(provider)} test notification.`);
  } catch (error) {
    showErrors([error.message || `Unable to send ${providerLabel(provider)} test`]);
  } finally {
    setBusy(false);
  }
}

async function createRuleOnServer(rule, action) {
  setBusy(true);
  try {
    const response = await fetch(`${apiBase}/rules`, {
      method: "POST",
      headers: writeHeaders(),
      body: JSON.stringify(rule),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Unable to create rule");
    }
    const savedRule = payload.rule;
    config.rules.push(savedRule);
    config.config_revision = payload.config_revision ?? config.config_revision;
    savedConfig = cloneConfig(config);
    selectedRuleId = savedRule.id;
    setDirty(false);
    renderAll();
    showSuccess(`${action}: ${savedRule.name}`);
  } catch (error) {
    showErrors([error.message || "Unable to create rule"]);
  } finally {
    setBusy(false);
  }
}

async function discardChanges() {
  if (!savedConfig) return;
  if (
    isDirty &&
    !(await confirmAction({
      title: "Discard changes?",
      message: "Discard all unsaved changes and return to the last saved configuration.",
      acceptLabel: "Discard",
      destructive: true,
    }))
  ) {
    return;
  }
  config = cloneConfig(savedConfig);
  selectedRuleId = selectExistingRuleId(selectedRuleId);
  setDirty(false);
  renderAll();
  clearMessage();
}

function normalizeConfig(payload) {
  return normalizeRuleNotificationProviders({
    ...payload,
    config_revision: Number(payload.config_revision) || 1,
    adsb_url: payload.adsb_url || "",
    home: {
      lat: payload.home?.lat ?? "",
      lon: payload.home?.lon ?? "",
    },
    poll_seconds: payload.poll_seconds ?? 30,
    stale_aircraft_seconds: payload.stale_aircraft_seconds ?? 90,
    notifications: payload.notifications || {},
    rules: normalizeRules(payload.rules),
  });
}

function normalizeRules(rules) {
  if (!Array.isArray(rules)) return [];
  return rules.map((rule) => ({...rule, id: rule.id || createClientRuleId(), enabled: rule.enabled !== false}));
}

function normalizeRuleNotificationProviders(payload) {
  const available = enabledNotificationProviders(payload);
  payload.rules = (payload.rules || []).map((rule) => {
    const selected = Array.isArray(rule.notification_providers) ? rule.notification_providers : available;
    return {
      ...rule,
      notification_providers: selected.filter((provider) => available.includes(provider)),
    };
  });
  return payload;
}

function cloneConfig(payload) {
  return JSON.parse(JSON.stringify(payload));
}

function confirmAction({title, message, acceptLabel = "Continue", cancelLabel = "Cancel", destructive = false}) {
  if (confirmResolver) closeConfirm(false);
  confirmReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmCancelButton.textContent = cancelLabel;
  confirmAcceptButton.textContent = acceptLabel;
  confirmAcceptButton.classList.toggle("danger", destructive);
  confirmModal.classList.remove("hidden");
  confirmCancelButton.focus();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  confirmModal.classList.add("hidden");
  confirmAcceptButton.classList.remove("danger");
  if (confirmReturnFocus) {
    confirmReturnFocus.focus();
  }
  confirmReturnFocus = null;
  resolve(result);
}

function commitCurrentView() {
  if (activeTab === "json") {
    return syncFromJson();
  }
  commitForms();
  return true;
}

function commitForms() {
  syncFromForms();
  renderJson();
}

function writeHeaders() {
  return {
    "Content-Type": "application/json",
    "If-Match": String(savedConfig?.config_revision ?? config?.config_revision ?? 1),
  };
}

function validateConfig(payload) {
  const errors = [];
  if (!payload.adsb_url) {
    errors.push(validationError("ADS-B endpoint is required.", fields.adsbUrl));
  }
  if (!isRequiredNumber(payload.home?.lat) || !isRequiredNumber(payload.home?.lon)) {
    errors.push(validationError("Home latitude and longitude are required.", [fields.homeLat, fields.homeLon]));
  }
  if (!Array.isArray(payload.rules) || payload.rules.length === 0) {
    errors.push("At least one rule is required.");
  }
  const duplicateNames = duplicateRuleNames(payload.rules || []);
  if (duplicateNames.length > 0) {
    errors.push(validationError(`Rule names must be unique: ${duplicateNames.join(", ")}.`, fields.ruleName));
  }
  const availableProviders = enabledNotificationProviders(payload);

  (payload.rules || []).forEach((rule, index) => {
    const label = rule.name || `Rule ${index + 1}`;
    if (!rule.name) {
      errors.push(ruleValidationError(`Rule ${index + 1} needs a name.`, rule, "name"));
    }
    if (!rule.event) {
      errors.push(ruleValidationError(`${label} needs an event type.`, rule, "event"));
    }
    if (!isRequiredNumber(rule.radius_miles)) {
      errors.push(ruleValidationError(`${label} needs a radius in miles.`, rule, "radius"));
    }
    if (!isRequiredNumber(rule.cooldown_minutes)) {
      errors.push(ruleValidationError(`${label} needs a cooldown in minutes.`, rule, "cooldown"));
    }
    if (rule.event === "tail" && (!Array.isArray(rule.tail_numbers) || rule.tail_numbers.length === 0)) {
      errors.push(ruleValidationError(`${label} needs at least one tail number, callsign, or ICAO hex.`, rule, "tailNumbers"));
    }
    if (
      rule.event === "aircraft_type" &&
      (!Array.isArray(rule.aircraft_types) || rule.aircraft_types.length === 0) &&
      (!Array.isArray(rule.categories) || rule.categories.length === 0)
    ) {
      errors.push(
        ruleValidationError(`${label} needs at least one aircraft type or category.`, rule, ["aircraftTypes", "categories"])
      );
    }
    if (rule.event === "circling" && !isRequiredNumber(rule.circling_min_heading_change_deg)) {
      errors.push(ruleValidationError(`${label} needs a heading change threshold.`, rule, "headingChange"));
    }
    if (rule.event === "circling" && !isRequiredNumber(rule.circling_window_minutes)) {
      errors.push(ruleValidationError(`${label} needs a circling window.`, rule, "windowMinutes"));
    }
    if (
      rule.enabled !== false &&
      availableProviders.length > 0 &&
      (!Array.isArray(rule.notification_providers) || rule.notification_providers.length === 0)
    ) {
      errors.push(ruleValidationError(`${label} needs at least one notification type.`, rule, "notificationProviders"));
    }
  });

  return errors;
}

function isRequiredNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function validationError(message, targets = []) {
  return {
    message,
    targets: Array.isArray(targets) ? targets.filter(Boolean) : [targets].filter(Boolean),
  };
}

function ruleValidationError(message, rule, keys) {
  const keyList = Array.isArray(keys) ? keys : [keys];
  const targets = rule.id === selectedRuleId ? keyList.map((key) => ruleFieldForKey(key)).filter(Boolean) : [];
  return {...validationError(message, targets), ruleId: rule.id};
}

function ruleFieldForKey(key) {
  return {
    name: fields.ruleName,
    event: fields.ruleEvent,
    radius: fields.ruleRadius,
    cooldown: fields.ruleCooldown,
    tailNumbers: fields.ruleTailNumbers,
    aircraftTypes: fields.ruleAircraftTypes,
    categories: fields.ruleCategories,
    notificationProviders: fields.ruleNotificationProviders,
    headingChange: fields.ruleHeadingChange,
    windowMinutes: fields.ruleWindowMinutes,
  }[key];
}

function createRule(eventType) {
  const base = {
    id: createClientRuleId(),
    name: uniqueRuleName(`New ${eventLabel(eventType).toLowerCase()} rule`),
    event: eventType,
    enabled: true,
    radius_miles: 25,
    cooldown_minutes: 30,
    notification_providers: enabledNotificationProviders(),
  };
  if (eventType === "tail") {
    return {...base, tail_numbers: ["N12345"]};
  }
  if (eventType === "military") {
    return {...base, military: true, max_altitude_ft: 25000};
  }
  if (eventType === "aircraft_type") {
    return {...base, aircraft_types: ["H60"], categories: []};
  }
  if (eventType === "circling") {
    return {
      ...base,
      max_altitude_ft: 10000,
      circling_min_heading_change_deg: 270,
      circling_window_minutes: 8,
    };
  }
  return base;
}

function createClientRuleId() {
  if (crypto.randomUUID) {
    return `rule-${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
  }
  return `rule-${Date.now().toString(36)}`;
}

function uniqueRuleName(baseName) {
  const names = new Set((config?.rules || []).map((rule) => String(rule.name || "").trim().toLowerCase()));
  if (!names.has(baseName.trim().toLowerCase())) return baseName;
  let index = 2;
  while (names.has(`${baseName} ${index}`.trim().toLowerCase())) {
    index += 1;
  }
  return `${baseName} ${index}`;
}

function duplicateRuleNames(rules) {
  const seen = new Map();
  const duplicates = [];
  rules.forEach((rule) => {
    const name = String(rule.name || "").trim();
    if (!name) return;
    const key = name.toLowerCase();
    if (seen.has(key) && !duplicates.includes(seen.get(key))) {
      duplicates.push(seen.get(key));
    }
    seen.set(key, seen.get(key) || name);
  });
  return duplicates;
}

function pruneRuleForEvent(rule) {
  if (rule.event !== "tail") delete rule.tail_numbers;
  if (rule.event !== "aircraft_type") {
    delete rule.aircraft_types;
    delete rule.categories;
  }
  if (rule.event !== "military") delete rule.military;
  if (rule.event !== "circling") {
    delete rule.circling_min_heading_change_deg;
    delete rule.circling_window_minutes;
  }
}

function enabledNotificationProviders(payload = config) {
  const notifications = payload?.notifications || {};
  return notificationProviderOrder.filter((provider) => {
    const providerConfig = notifications[provider];
    return providerConfig && providerConfig.enabled === true;
  });
}

function updateRuleFieldVisibility(eventType) {
  document.querySelectorAll(".tail-field").forEach((node) => node.classList.toggle("hidden", eventType !== "tail"));
  document.querySelectorAll(".aircraft-type-field").forEach((node) => {
    node.classList.toggle("hidden", eventType !== "aircraft_type");
  });
  document.querySelectorAll(".military-field").forEach((node) => node.classList.toggle("hidden", eventType !== "military"));
  document.querySelectorAll(".circling-field").forEach((node) => node.classList.toggle("hidden", eventType !== "circling"));
}

function getSelectedRule() {
  return config?.rules?.find((rule) => rule.id === selectedRuleId) || null;
}

function selectedRuleIndex() {
  return Math.max(0, (config?.rules || []).findIndex((rule) => rule.id === selectedRuleId));
}

function selectExistingRuleId(preferredRuleId) {
  const rules = config?.rules || [];
  if (preferredRuleId && rules.some((rule) => rule.id === preferredRuleId)) {
    return preferredRuleId;
  }
  return rules[0]?.id || null;
}

function setOptionalNumber(target, key, input, integer = false) {
  if (input.value.trim() === "") {
    delete target[key];
    return;
  }
  target[key] = integer ? integerValue(input) : numberValue(input);
}

function numberValue(input, fallback = null) {
  if (input.value === "") return fallback;
  const value = Number(input.value);
  return Number.isFinite(value) ? value : fallback;
}

function integerValue(input, fallback = null) {
  const value = numberValue(input, fallback);
  return value === null ? null : Math.trunc(value);
}

function optionalIntegerValue(input) {
  const value = input.value.trim();
  if (value === "") return "";
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : "";
}

function listToText(value) {
  if (Array.isArray(value)) return value.join(", ");
  return value || "";
}

function textToList(value) {
  if (value instanceof HTMLInputElement || value instanceof HTMLTextAreaElement) {
    return textToList(value.value);
  }
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (value === null || value === undefined) {
    return [];
  }
  return String(value)
    .split(/[\s,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function emptyState(message) {
  const node = document.createElement("p");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function eventLabel(eventType) {
  return {
    tail: "Tail",
    military: "Military",
    aircraft_type: "Aircraft type",
    circling: "Circling",
}[eventType] || "Unknown";
}

function providerLabel(provider) {
  return {
    email: "email",
    pushover: "Pushover",
    twilio: "Twilio SMS",
    webhook: "webhook",
  }[provider] || provider;
}

function ruleSummary(rule) {
  if (rule.event === "tail") return listToText(rule.tail_numbers) || "No tail";
  if (rule.event === "aircraft_type") return listToText([...(rule.aircraft_types || []), ...(rule.categories || [])]) || "No type";
  if (rule.event === "military") return "Military flag";
  if (rule.event === "circling") return `${rule.circling_min_heading_change_deg ?? 270} deg`;
  return `${rule.cooldown_minutes ?? 30} min`;
}

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function isRuleField(target) {
  return target.id.startsWith("rule-");
}

function setStatus(message, isError = false) {
  statusLabel.textContent = message;
  statusLabel.classList.toggle("error", isError);
}

function setDirty(nextIsDirty) {
  isDirty = nextIsDirty;
  discardButton.disabled = !isDirty || !config;
  saveButton.classList.toggle("dirty", isDirty);
  if (isDirty) {
    setStatus("Unsaved changes");
  } else if (config) {
    setStatus("Configuration loaded");
  }
}

function showErrors(errors) {
  const normalizedErrors = errors.map((error) => (typeof error === "string" ? validationError(error) : error));
  clearValidationState();
  setStatus(normalizedErrors[0]?.message || "Unable to save configuration", true);
  messagePanel.className = "message-panel error";
  const list = document.createElement("ul");
  for (const error of normalizedErrors) {
    const item = document.createElement("li");
    item.textContent = error.message;
    list.append(item);
  }
  messagePanel.replaceChildren(list);
  applyValidationState(normalizedErrors);
}

function showSuccess(message) {
  clearValidationState();
  statusLabel.classList.remove("error");
  messagePanel.className = "message-panel success";
  messagePanel.textContent = message;
}

function clearMessage() {
  statusLabel.classList.remove("error");
  clearValidationState();
  messagePanel.className = "message-panel hidden";
  messagePanel.replaceChildren();
}

function applyValidationState(errors) {
  for (const error of errors) {
    for (const target of error.targets || []) {
      target.classList.add("invalid");
      target.setAttribute("aria-invalid", "true");
    }
    if (error.ruleId) {
      const ruleItem = Array.from(ruleList.querySelectorAll(".rule-item")).find((item) => item.dataset.ruleId === error.ruleId);
      if (ruleItem) ruleItem.classList.add("invalid");
    }
  }
}

function clearValidationState() {
  document.querySelectorAll(".invalid").forEach((node) => {
    node.classList.remove("invalid");
    node.removeAttribute("aria-invalid");
  });
}

function setBusy(isBusy) {
  reloadButton.disabled = isBusy;
  discardButton.disabled = isBusy || !isDirty || !config;
  saveButton.disabled = isBusy;
  testEmailButton.disabled = isBusy;
  testTwilioButton.disabled = isBusy;
  testWebhookButton.disabled = isBusy;
}
