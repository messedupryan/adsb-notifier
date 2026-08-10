let config = null;
let savedConfig = null;
let isDirty = false;
let isJsonDirty = false;
let selectedRuleId = null;
let activeTab = "dashboard";
const uiVersion = "0.0.4";
const redactedSecret = "********";
const notificationProviderOrder = ["pushover", "email", "twilio"];
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
refreshStatusButton.addEventListener("click", () => loadWorkerStatus());
recenterMapButton.addEventListener("click", () => recenterDashboardMap());
fitMapButton.addEventListener("click", () => fitDashboardMap());
selectedMapButton.addEventListener("click", () => zoomSelectedMatch());
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
  if (favicon) favicon.href = assets.icon;
  if (appleTouchIcon) appleTouchIcon.href = assets.icon;
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
    isJsonDirty = false;
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
    isJsonDirty = false;
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
    isJsonDirty = true;
    setDirty(true);
    clearMessage();
    return;
  }

  isJsonDirty = false;
  if (event.target === fields.ruleEvent) {
    syncSelectedRuleFromForms();
    renderRuleEditor();
    renderRuleList();
    renderJson();
  } else if (
    event.target === fields.ruleName ||
    event.target === fields.ruleEnabled ||
    event.target === fields.ruleRadius ||
    event.target === fields.ruleCooldown ||
    event.target === fields.ruleIncludeTisb
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
  activeTab = tabName;
  document.querySelectorAll(".tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.tab === tabName);
  });
  document.querySelectorAll(".tab-panel").forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabName);
  });
  if (tabName === "dashboard") {
    loadWorkerStatus();
  } else if (tabName === "settings" && !isJsonDirty) {
    renderJson();
  }
}

function renderAll() {
  renderForms();
  renderRuleList();
  renderRuleEditor();
  renderJson();
  if (latestWorkerStatus) renderDashboardMap(latestWorkerStatus);
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
  latestWorkerStatus = status;
  workerStatusValue.textContent = status.status || "unknown";
  workerLastPoll.textContent = formatDateTime(status.last_poll_at) || "Never";
  workerAircraftCount.textContent = status.aircraft_count ?? "0";
  workerNotificationCount.textContent = status.notification_count ?? "0";
  workerAdsbSource.textContent = status.adsb_url || "Unknown";
  const retryAt = formatDateTime(status.rate_limit_retry_at);
  const backoffSeconds = Number(status.rate_limit_backoff_seconds || 0);
  workerRateLimitRetry.textContent = retryAt ? `${retryAt} (${backoffSeconds}s)` : "None";
  workerLastError.textContent = status.last_error || "None";

  recentMatches.replaceChildren();
  const matches = Array.isArray(status.recent_matches) ? status.recent_matches : [];
  if (matches.length === 0) {
    selectedRecentMatchKey = null;
    recentMatches.append(emptyState("No recent matches"));
    return;
  }
  if (selectedRecentMatchKey && !matches.some((match) => matchKey(match) === selectedRecentMatchKey)) {
    selectedRecentMatchKey = null;
  }
  matches.slice(0, 10).forEach((match) => {
    const key = matchKey(match);
    const item = document.createElement("div");
    item.className = "match-item";
    item.classList.toggle("selected", key === selectedRecentMatchKey);
    item.role = "button";
    item.tabIndex = 0;
    item.dataset.matchKey = key;
    const title = document.createElement("strong");
    title.textContent = `${match.rule_name || "Rule"}: ${match.aircraft_label || match.hex || "Aircraft"}`;
    const meta = document.createElement("span");
    const type = match.aircraft_type || "unknown type";
    const distance = match.distance_miles ?? "unknown";
    const altitude = match.altitude_ft === null || match.altitude_ft === undefined ? "unknown altitude" : `${match.altitude_ft} ft`;
    meta.textContent = `${type} · ${distance} mi · ${altitude}`;
    const time = document.createElement("span");
    time.className = "match-time";
    time.textContent = formatDateTime(match.observed_at) || "Unknown time";
    item.append(title, meta, time, matchExternalLink(match));
    recentMatches.append(item);
  });
  renderDashboardMap(status);
}

function renderDashboardMap(status) {
  if (!alertMap || !alertMapEmpty) return;
  const home = config?.home || {};
  const homeLat = Number(home.lat);
  const homeLon = Number(home.lon);
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) {
    alertMapEmpty.textContent = "Home location is not configured";
    alertMapEmpty.classList.remove("hidden");
    return;
  }
  if (!window.L) {
    alertMapEmpty.textContent = "Map library unavailable";
    alertMapEmpty.classList.remove("hidden");
    return;
  }

  const map = ensureDashboardMap(homeLat, homeLon);
  dashboardMapLayers.clearLayers();

  window.L.circleMarker([homeLat, homeLon], {
    radius: 7,
    color: "#17202a",
    fillColor: currentAccentColor(),
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup("Home")
    .addTo(dashboardMapLayers);

  activeRulesWithRadius().forEach((rule) => {
    window.L.circle([homeLat, homeLon], {
      radius: milesToMeters(rule.radius_miles),
      color: eventColor(rule.event),
      fillColor: eventColor(rule.event),
      fillOpacity: 0.04,
      weight: 1.5,
    })
      .bindPopup(`${escapeHtml(rule.name || "Rule")} · ${Number(rule.radius_miles).toFixed(1)} mi`)
      .addTo(dashboardMapLayers);
  });

  const matches = (Array.isArray(status.recent_matches) ? status.recent_matches : []).filter((match) =>
    hasPosition(match)
  );
  matches.slice(0, 20).forEach((match) => {
    const latLng = [Number(match.lat), Number(match.lon)];
    const isSelected = matchKey(match) === selectedRecentMatchKey;
    const marker = window.L.circleMarker(latLng, {
      radius: isSelected ? 10 : 8,
      color: "#17202a",
      fillColor: isSelected ? selectedMatchColor() : eventColor(match.event_type),
      fillOpacity: isSelected ? 1 : 0.88,
      weight: isSelected ? 2.5 : 1.5,
    })
      .bindPopup(matchPopupHtml(match))
      .addTo(dashboardMapLayers);
    marker.on("click", () => selectRecentMatch(matchKey(match)));

    if (Number.isFinite(Number(match.track_deg))) {
      window.L.polyline([latLng, projectedTrackPoint(Number(match.lat), Number(match.lon), Number(match.track_deg), 0.8)], {
        color: isSelected ? selectedMatchColor() : eventColor(match.event_type),
        opacity: isSelected ? 1 : 0.78,
        weight: isSelected ? 3.5 : 2,
      }).addTo(dashboardMapLayers);
    }
  });

  alertMapEmpty.textContent = matches.length === 0 ? "No recent matches with positions" : "";
  alertMapEmpty.classList.toggle("hidden", matches.length > 0);
  updateMapActionState();
  // Fit after every redraw because Leaflet calculates bounds from current
  // container pixels; dashboard layout changes can otherwise leave stale sizing.
  fitDashboardMap({maxZoom: dashboardMapZoom()});
}

function ensureDashboardMap(homeLat, homeLon) {
  if (dashboardMap) return dashboardMap;
  dashboardMap = window.L.map(alertMap, {
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView([homeLat, homeLon], 11);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(dashboardMap);
  window.L.control.scale({imperial: true, metric: false}).addTo(dashboardMap);
  dashboardMapLayers = window.L.layerGroup().addTo(dashboardMap);
  return dashboardMap;
}

function recenterDashboardMap() {
  if (!dashboardMap || !config?.home) return;
  const homeLat = Number(config.home.lat);
  const homeLon = Number(config.home.lon);
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) return;

  const center = [homeLat, homeLon];
  const zoom = dashboardMapZoom();
  dashboardMap.invalidateSize();
  dashboardMap.setView(center, zoom, {animate: false});
  requestAnimationFrame(() => {
    dashboardMap.invalidateSize();
    dashboardMap.setView(center, zoom, {animate: false});
  });
}

function fitDashboardMap({maxZoom = 13} = {}) {
  if (!dashboardMap || !window.L || !config?.home) return;
  const homeLat = Number(config.home.lat);
  const homeLon = Number(config.home.lon);
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) return;

  const bounds = window.L.latLngBounds([[homeLat, homeLon]]);
  // Include rule radii as well as matched positions so initial zoom shows the
  // alert area, not just the latest aircraft cluster.
  activeRulesWithRadius().forEach((rule) => {
    bounds.extend(radiusBounds(homeLat, homeLon, Number(rule.radius_miles)));
  });
  recentMatchesWithPositions().forEach((match) => {
    bounds.extend([Number(match.lat), Number(match.lon)]);
  });

  dashboardMap.invalidateSize();
  dashboardMap.fitBounds(bounds, {padding: [28, 28], maxZoom, animate: false});
}

function zoomSelectedMatch() {
  if (!dashboardMap || !window.L || !config?.home) return;
  const match = selectedMatchWithPosition();
  if (!match) return;
  const homeLat = Number(config.home.lat);
  const homeLon = Number(config.home.lon);
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) return;

  const bounds = window.L.latLngBounds([
    [homeLat, homeLon],
    [Number(match.lat), Number(match.lon)],
  ]);
  dashboardMap.invalidateSize();
  dashboardMap.fitBounds(bounds, {padding: [42, 42], maxZoom: 12, animate: false});
}

function updateMapActionState() {
  selectedMapButton.disabled = !selectedMatchWithPosition();
}

recentMatches.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const item = event.target.closest(".match-item");
  if (!item?.dataset.matchKey) return;
  selectRecentMatch(item.dataset.matchKey);
});
recentMatches.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const item = event.target.closest(".match-item");
  if (!item?.dataset.matchKey) return;
  event.preventDefault();
  selectRecentMatch(item.dataset.matchKey);
});

function selectRecentMatch(key) {
  selectedRecentMatchKey = selectedRecentMatchKey === key ? null : key;
  if (latestWorkerStatus) {
    renderWorkerStatus(latestWorkerStatus);
  }
  updateMapActionState();
}

function renderForms() {
  if (!config) return;
  const notifications = config.notifications || {};
  const email = notifications.email || {};
  const pushover = notifications.pushover || {};
  const twilio = notifications.twilio || {};

  fields.adsbUrl.value = config.adsb_url || "";
  fields.homeLat.value = config.home?.lat ?? "";
  fields.homeLon.value = config.home?.lon ?? "";
  fields.pollSeconds.value = config.poll_seconds ?? 30;
  fields.staleAircraftSeconds.value = config.stale_aircraft_seconds ?? 90;
  fields.recentMatchesWindowHours.value = config.recent_matches_window_hours ?? 24;

  fields.emailEnabled.checked = Boolean(email.enabled);
  fields.emailSmtpHost.value = email.smtp_host || "";
  fields.emailSmtpPort.value = email.smtp_port ?? 587;
  fields.emailStarttls.checked = email.starttls !== false;
  fields.emailUsername.value = email.username || "";
  fields.emailPassword.value = secretFieldValue(email.password);
  fields.emailFrom.value = email.from || "";
  fields.emailTo.value = listToText(email.to);
  fields.emailHtmlEnabled.checked = Boolean(email.html_enabled);
  fields.emailBrandTheme.value = email.brand_theme || "teal";
  fields.emailIncludeBrandImages.checked = email.include_brand_images !== false;
  fields.emailSubjectTemplate.value = email.subject_template || "";
  fields.emailBodyTemplate.value = email.body_template || "";
  fields.emailHtmlBodyTemplate.value = email.html_body_template || "";

  fields.pushoverEnabled.checked = Boolean(pushover.enabled);
  fields.pushoverAppToken.value = secretFieldValue(pushover.app_token);
  fields.pushoverUserKey.value = secretFieldValue(pushover.user_key);
  fields.pushoverDevice.value = pushover.device || "";
  fields.pushoverPriority.value = pushover.priority ?? "";
  fields.pushoverSound.value = pushover.sound || "";
  fields.pushoverTitleTemplate.value = pushover.title_template || pushover.title || "";
  fields.pushoverUrlTemplate.value = pushover.url_template || "";
  fields.pushoverUrlTitleTemplate.value = pushover.url_title_template || "";
  fields.pushoverMessageTemplate.value = pushover.message_template || pushover.body_template || pushover.template || "";

  fields.twilioEnabled.checked = Boolean(twilio.enabled);
  fields.twilioAccountSid.value = twilio.account_sid || "";
  fields.twilioApiKeySid.value = twilio.api_key_sid || "";
  fields.twilioApiKeySecret.value = secretFieldValue(twilio.api_key_secret);
  fields.twilioFrom.value = twilio.from || "";
  fields.twilioTo.value = twilio.to || "";
  fields.twilioBodyTemplate.value = twilio.body_template || twilio.message_template || twilio.template || "";
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
  fields.ruleMilitary.checked = (rule.event || "tail") === "military";
  fields.ruleMilitary.disabled = true;
  fields.ruleIncludeTisb.checked = rule.include_tisb === true;
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
  if (isJsonDirty) return;
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
  config.recent_matches_window_hours = integerValue(fields.recentMatchesWindowHours, 24);
  const notifications = config.notifications || {};
  const existingEmail = notifications.email || {};
  const existingPushover = notifications.pushover || {};
  const existingTwilio = notifications.twilio || {};
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
      html_enabled: fields.emailHtmlEnabled.checked,
      brand_theme: fields.emailBrandTheme.value,
      include_brand_images: fields.emailIncludeBrandImages.checked,
      subject_template: fields.emailSubjectTemplate.value.trim(),
      body_template: fields.emailBodyTemplate.value.trim(),
      html_body_template: fields.emailHtmlBodyTemplate.value.trim(),
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
      url_template: fields.pushoverUrlTemplate.value.trim(),
      url_title_template: fields.pushoverUrlTitleTemplate.value.trim(),
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
    rule.military = rule.event === "military";
    rule.include_tisb = fields.ruleIncludeTisb.checked;
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
    isJsonDirty = false;
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
    isJsonDirty = false;
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
    isJsonDirty = false;
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
  isJsonDirty = false;
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
    recent_matches_window_hours: payload.recent_matches_window_hours ?? 24,
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
    const selected =
      Array.isArray(rule.notification_providers) && rule.notification_providers.length > 0
        ? rule.notification_providers
        : available;
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
  if (isJsonDirty) {
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
  if (!isRequiredNumber(payload.recent_matches_window_hours)) {
    errors.push(validationError("Recent matches hours is required.", fields.recentMatchesWindowHours));
  } else if (Number(payload.recent_matches_window_hours) < 1 || Number(payload.recent_matches_window_hours) > 168) {
    errors.push(validationError("Recent matches hours must be between 1 and 168.", fields.recentMatchesWindowHours));
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
    return {...base, military: true, include_tisb: false, max_altitude_ft: 25000};
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
  if (rule.event !== "military") {
    delete rule.military;
    delete rule.include_tisb;
  }
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

function secretFieldValue(value) {
  return value ? redactedSecret : "";
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

function activeRulesWithRadius() {
  return (config?.rules || []).filter((rule) => rule.enabled !== false && Number.isFinite(Number(rule.radius_miles)));
}

function recentMatchesWithPositions() {
  const matches = Array.isArray(latestWorkerStatus?.recent_matches) ? latestWorkerStatus.recent_matches : [];
  return matches.filter((match) => hasPosition(match));
}

function selectedMatchWithPosition() {
  if (!selectedRecentMatchKey) return null;
  return recentMatchesWithPositions().find((match) => matchKey(match) === selectedRecentMatchKey) || null;
}

function dashboardMapZoom() {
  const radii = activeRulesWithRadius().map((rule) => Number(rule.radius_miles)).filter((radius) => radius > 0);
  const largestRadius = radii.length ? Math.max(...radii) : 10;
  if (largestRadius <= 2) return 13;
  if (largestRadius <= 5) return 12;
  if (largestRadius <= 15) return 11;
  return 10;
}

function hasPosition(match) {
  return Number.isFinite(Number(match.lat)) && Number.isFinite(Number(match.lon));
}

function milesToMeters(miles) {
  return Number(miles) * 1609.344;
}

function radiusBounds(lat, lon, radiusMiles) {
  const latitudeDelta = radiusMiles / 69;
  const longitudeMilesPerDegree = Math.max(1, 69 * Math.cos((lat * Math.PI) / 180));
  const longitudeDelta = radiusMiles / longitudeMilesPerDegree;
  return [
    [lat - latitudeDelta, lon - longitudeDelta],
    [lat + latitudeDelta, lon + longitudeDelta],
  ];
}

function eventColor(eventType) {
  return {
    tail: "#2563eb",
    military: "#be3455",
    aircraft_type: "#1f7a6d",
    circling: "#b45309",
  }[eventType] || currentAccentColor();
}

function currentAccentColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1f7a6d";
}

function selectedMatchColor() {
  return "#dc2626";
}

function matchKey(match) {
  return [
    match.observed_at || "",
    match.rule_name || "",
    match.hex || "",
    match.aircraft_label || "",
  ].join("|");
}

function projectedTrackPoint(lat, lon, headingDeg, distanceMiles) {
  const earthRadiusMiles = 3958.7613;
  const angularDistance = distanceMiles / earthRadiusMiles;
  const heading = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(heading)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(heading) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
}

function matchPopupHtml(match) {
  const title = `${match.rule_name || "Rule"}: ${match.aircraft_label || match.hex || "Aircraft"}`;
  const type = match.aircraft_type || match.category || "unknown type";
  const altitude = match.altitude_ft === null || match.altitude_ft === undefined ? "unknown altitude" : `${match.altitude_ft} ft`;
  const observed = formatDateTime(match.observed_at) || "Unknown time";
  const source = match.source_type ? ` · ${match.source_type}` : "";
  const link = match.adsb_exchange_url
    ? `<br /><a href="${escapeHtml(match.adsb_exchange_url)}" target="_blank" rel="noopener noreferrer">ADS-B Exchange</a>`
    : "";
  return `
    <strong>${escapeHtml(title)}</strong><br />
    ${escapeHtml(type)} · ${escapeHtml(String(match.distance_miles ?? "unknown"))} mi · ${escapeHtml(altitude)}<br />
    ${escapeHtml(observed)}<br />
    ${escapeHtml(match.hex || "")}${escapeHtml(source)}
    ${link}
  `;
}

function matchExternalLink(match) {
  const link = document.createElement("a");
  link.className = "external-match-link";
  link.textContent = "ADS-B Exchange";
  if (match.adsb_exchange_url) {
    link.href = match.adsb_exchange_url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  } else {
    link.href = "#";
    link.setAttribute("aria-disabled", "true");
  }
  return link;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
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
  }[provider] || provider;
}

function ruleSummary(rule) {
  if (rule.event === "tail") return listToText(rule.tail_numbers) || "No tail";
  if (rule.event === "aircraft_type") return listToText([...(rule.aircraft_types || []), ...(rule.categories || [])]) || "No type";
  if (rule.event === "military") return rule.include_tisb ? "Military + TIS-B" : "Military flag";
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
}
