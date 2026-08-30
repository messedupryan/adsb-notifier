function renderForms() {
  if (!config) return;
  const notifications = config.notifications || {};
  const email = notifications.email || {};
  const pushover = notifications.pushover || {};
  const twilio = notifications.twilio || {};
  const source = normalizeAdsbSource(config.adsb_source, config.adsb_url);
  const backupSource = normalizeAdsbSource(config.backup_adsb_source, "", "local_receiver");

  fields.adsbUrl.value = config.adsb_url || "";
  fields.adsbSourceProvider.value = source.provider;
  fields.adsbSourceQuery.value = source.query;
  fields.adsbSourceRadius.value = source.radius_miles ?? "";
  fields.adsbSourceValue.value = source.value || "";
  fields.adsbSourceBaseUrl.value = source.base_url || "";
  fields.backupSourceEnabled.checked = Boolean(config.backup_adsb_source);
  fields.backupSourceProvider.value = backupSource.provider === "direct" ? "local_receiver" : backupSource.provider;
  fields.backupSourceQuery.value = backupSource.query;
  fields.backupSourceRadius.value = backupSource.radius_miles ?? "";
  fields.backupSourceValue.value = backupSource.value || "";
  fields.backupSourceBaseUrl.value = backupSource.base_url || "";
  updateAdsbSourceFieldVisibility();
  updateBackupSourceFieldVisibility();
  fields.homeLat.value = config.home?.lat ?? "";
  fields.homeLon.value = config.home?.lon ?? "";
  fields.pollSeconds.value = config.poll_seconds ?? DEFAULT_POLL_SECONDS;
  fields.primaryRetryMinutes.value = config.primary_retry_minutes ?? DEFAULT_PRIMARY_RETRY_MINUTES;
  fields.staleAircraftSeconds.value = config.stale_aircraft_seconds ?? DEFAULT_STALE_AIRCRAFT_SECONDS;
  fields.recentMatchesWindowHours.value = config.recent_matches_window_hours ?? DEFAULT_RECENT_MATCHES_WINDOW_HOURS;
  fields.sourceHealthTrendRetentionHours.value =
    config.source_health_trend_retention_hours ?? DEFAULT_SOURCE_HEALTH_TREND_RETENTION_HOURS;
  fields.globalExclusionTailNumbers.value = listToText(config.exclusions?.tail_numbers);
  fields.globalExclusionHexIds.value = listToText(config.exclusions?.hex_ids);
  fields.globalExclusionCallsigns.value = listToText(config.exclusions?.callsigns);
  fields.globalExclusionAircraftTypes.value = listToText(config.exclusions?.aircraft_types);
  fields.globalExclusionCategories.value = listToText(config.exclusions?.categories);

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
  fields.emailIncludeMapSnapshot.checked = email.include_map_snapshot === true;
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
  ensureSelectedNotificationProvider();
  renderNotificationProviderSelector();
  renderNotificationProviderPanels();
  renderNotificationPreview();
  renderSourceHealth(latestWorkerStatus || {status: "unknown", recent_matches: []});
  renderRuleEditor();
}

function notificationProviderConfigs() {
  const notifications = config?.notifications || {};
  return notificationProviderOrder.map((provider) => ({
    provider,
    label: providerLabel(provider),
    enabled: Boolean(notifications[provider]?.enabled),
  }));
}

function sortedNotificationProviders() {
  return notificationProviderConfigs().sort((left, right) => {
    if (left.enabled !== right.enabled) return left.enabled ? -1 : 1;
    return left.label.localeCompare(right.label);
  });
}

function ensureSelectedNotificationProvider() {
  const providers = sortedNotificationProviders();
  const current = providers.find((entry) => entry.provider === selectedNotificationProvider);
  if (current) return;
  selectedNotificationProvider = providers[0]?.provider || notificationProviderOrder[0];
}

function renderNotificationProviderSelector() {
  if (!notificationProviderSelector) return;
  notificationProviderSelector.replaceChildren();
  sortedNotificationProviders().forEach(({provider, label, enabled}) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.notificationProvider = provider;
    button.className = "notification-provider-tab";
    button.setAttribute("role", "tab");
    button.setAttribute("aria-selected", String(provider === selectedNotificationProvider));
    button.classList.toggle("active", provider === selectedNotificationProvider);
    button.classList.toggle("disabled-provider", !enabled);
    button.textContent = enabled ? label : `${label} off`;
    notificationProviderSelector.append(button);
  });
}

function selectNotificationProvider(provider) {
  if (!notificationProviderOrder.includes(provider)) return;
  syncFromForms();
  selectedNotificationProvider = provider;
  renderNotificationProviderSelector();
  renderNotificationProviderPanels();
  renderNotificationPreview();
  renderJson();
}

function renderNotificationProviderPanels() {
  document.querySelectorAll("[data-provider-panel]").forEach((panel) => {
    const isSelected = panel.dataset.providerPanel === selectedNotificationProvider;
    panel.hidden = !isSelected;
    panel.setAttribute("aria-hidden", String(!isSelected));
  });
}

function renderNotificationPreview() {
  if (!notificationPreview || !config) return;
  const {match, source} = notificationPreviewMatch();
  const context = notificationTemplateContext(match);
  notificationPreviewSource.textContent = source;
  notificationPreview.replaceChildren();
  if (selectedNotificationProvider === "email") {
    renderEmailPreview(context);
  } else if (selectedNotificationProvider === "pushover") {
    renderPushoverPreview(context);
  } else if (selectedNotificationProvider === "twilio") {
    renderTwilioPreview(context);
  } else {
    notificationPreview.append(previewEmpty("No provider selected."));
  }
}

function notificationPreviewMatch() {
  const matches = latestWorkerStatus?.recent_matches || [];
  if (matches.length > 0) {
    return {match: matches[0], source: "Recent match"};
  }
  return {match: sampleNotificationPreviewMatch(), source: "Sample aircraft"};
}

function sampleNotificationPreviewMatch() {
  return {
    rule_name: "Denver arrivals",
    event_type: "tail",
    observed_at: new Date("2026-08-29T18:24:00Z").toISOString(),
    distance_miles: 12.4,
    aircraft_label: "N123AB",
    registration: "N123AB",
    flight: "UAL123",
    hex: "A1B2C3",
    airplanes_live_url: "https://globe.airplanes.live/?icao=A1B2C3",
    adsb_exchange_url: "https://globe.airplanes.live/?icao=A1B2C3",
    aircraft_type: "B738",
    category: "A3",
    description: "Boeing 737-800",
    operator: "United Airlines",
    altitude_ft: 18750,
    altitude_label: "18750 ft",
    track_deg: 265,
    track_label: "265 deg",
    ground_speed_kt: 418,
    ground_speed_label: "418 kt",
    vertical_rate_fpm: -832,
    vertical_rate_label: "-832 fpm",
    squawk: "1200",
    emergency: "",
    military: false,
    lat: 39.7392,
    lon: -104.9903,
    seen_seconds: 3.2,
    seen_label: "3.2s ago",
  };
}

function notificationTemplateContext(match) {
  const distance = numberOrDefault(match.distance_miles, 0);
  const altitude = match.altitude_ft ?? match.aircraft_payload?.alt_baro ?? match.aircraft_payload?.alt_geom ?? "";
  const track = match.track_deg ?? match.aircraft_payload?.track ?? "";
  const groundSpeed = match.ground_speed_kt ?? match.aircraft_payload?.gs ?? match.aircraft_payload?.speed ?? "";
  const verticalRate = match.vertical_rate_fpm ?? match.aircraft_payload?.baro_rate ?? match.aircraft_payload?.geom_rate ?? "";
  const seenSeconds = match.seen_seconds ?? match.aircraft_payload?.seen ?? "";
  const hex = match.hex || match.aircraft_payload?.hex || "";
  const aircraftType = match.aircraft_type || match.category || "unknown type";
  const altitudeLabel = altitude ? `${altitude} ft` : "unknown altitude";
  const context = {
    message: `${match.rule_name || "Rule"}: ${match.aircraft_label || hex || "Aircraft"} (${aircraftType}) ${distance.toFixed(1)} mi away at ${altitudeLabel}`,
    rule_name: match.rule_name || "",
    event_type: match.event_type || "",
    observed_at: match.observed_at || "",
    distance_miles: distance,
    distance_miles_1: distance.toFixed(1),
    aircraft_label: match.aircraft_label || match.registration || match.flight || hex || "Aircraft",
    registration: match.registration || "",
    flight: match.flight || "",
    hex,
    airplanes_live_url: match.airplanes_live_url || match.adsb_exchange_url || (hex ? `https://globe.airplanes.live/?icao=${hex}` : ""),
    adsb_exchange_url: match.adsb_exchange_url || match.airplanes_live_url || (hex ? `https://globe.airplanes.live/?icao=${hex}` : ""),
    aircraft_type: aircraftType,
    category: match.category || "",
    description: match.description || match.aircraft_payload?.desc || "",
    operator: match.operator || match.aircraft_payload?.ownOp || match.aircraft_payload?.op || "",
    altitude_ft: altitude,
    altitude_label: altitudeLabel,
    track_deg: track,
    track_label: track !== "" ? `${Number(track).toFixed(0)} deg` : "unknown",
    ground_speed_kt: groundSpeed,
    ground_speed_label: groundSpeed !== "" ? `${groundSpeed} kt` : "unknown",
    vertical_rate_fpm: verticalRate,
    vertical_rate_label: verticalRate !== "" ? `${verticalRate} fpm` : "unknown",
    squawk: match.squawk || match.aircraft_payload?.squawk || "",
    emergency: match.emergency || match.aircraft_payload?.emergency || "",
    military: Boolean(match.military),
    lat: match.lat ?? match.aircraft_payload?.lat ?? "",
    lon: match.lon ?? match.aircraft_payload?.lon ?? "",
    seen_seconds: seenSeconds,
    seen_label: seenSeconds !== "" ? `${Number(seenSeconds).toFixed(1)}s ago` : "unknown",
    map_snapshot_html: "",
  };
  context.message_html = escapeHtml(context.message).replace(/\n/g, "<br />");
  Object.entries({...context}).forEach(([key, value]) => {
    context[`${key}_html`] = escapeHtml(value);
  });
  return context;
}

function renderEmailPreview(context) {
  const email = config.notifications?.email || {};
  const subject = renderNotificationTemplate(email.subject_template || "ADS-B alert", context);
  const body = renderNotificationTemplate(email.body_template || context.message, context);
  notificationPreview.append(previewField("Subject", subject), previewField("Text body", body));
  if (email.html_enabled) {
    const htmlTemplate = email.html_body_template || "{message_html}";
    const htmlContext = emailHtmlPreviewContext(email, context);
    const htmlBody = emailHtmlPreviewBody(email, htmlTemplate, renderNotificationTemplate(htmlTemplate, htmlContext));
    const htmlDocument = emailHtmlPreviewDocument(email, htmlBody);
    notificationPreview.append(emailHtmlPreviewField(htmlDocument));
  }
}

function renderPushoverPreview(context) {
  const pushover = config.notifications?.pushover || {};
  const title = renderNotificationTemplate(pushover.title_template || "ADS-B alert", context);
  const message = renderNotificationTemplate(pushover.message_template || context.message, context);
  const url = renderNotificationTemplate(pushover.url_template || context.airplanes_live_url, context);
  const urlTitle = renderNotificationTemplate(pushover.url_title_template || "Airplanes.live", context);
  notificationPreview.append(previewField("Title", title), previewField("Message", message), previewField("URL", url), previewField("URL title", urlTitle));
}

function renderTwilioPreview(context) {
  const twilio = config.notifications?.twilio || {};
  const message = renderNotificationTemplate(twilio.body_template || context.message, context);
  notificationPreview.append(previewField("Message", message));
}

function renderNotificationTemplate(template, context) {
  return String(template || "").replace(/\{([a-zA-Z_][\w]*)(?::([^}]+))?\}/g, (placeholder, key, format) => {
    if (!(key in context)) return placeholder;
    const value = context[key];
    if (format === ".1f" && value !== "" && value !== null && value !== undefined) {
      return Number(value).toFixed(1);
    }
    if (format === ".0f" && value !== "" && value !== null && value !== undefined) {
      return Number(value).toFixed(0);
    }
    return String(value ?? "");
  });
}

function emailHtmlPreviewContext(email, context) {
  const previewContext = {...context};
  const themeColor = emailThemeColor(email);
  previewContext.message_html = `<span style="font-size:24px;font-weight:700;color:${themeColor};">${escapeHtml(context.message)}</span>`;
  previewContext.map_snapshot_html = email.include_map_snapshot ? emailMapSnapshotPreviewHtml() : "";
  Object.entries({message_html: previewContext.message_html, map_snapshot_html: previewContext.map_snapshot_html}).forEach(([key, value]) => {
    previewContext[`${key}_html`] = escapeHtml(value);
  });
  return previewContext;
}

function emailHtmlPreviewBody(email, template, body) {
  let htmlBody = body;
  if (email.include_map_snapshot && !template.includes("{map_snapshot_html}")) {
    const tableStart = htmlBody.indexOf("<table");
    const snapshot = emailMapSnapshotPreviewHtml();
    htmlBody = tableStart >= 0 ? `${htmlBody.slice(0, tableStart)}${snapshot}\n\n${htmlBody.slice(tableStart)}` : `${htmlBody}\n${snapshot}`;
  }
  return htmlBody.replaceAll("<table>", '<table style="margin:0 auto;text-align:left;">');
}

function emailMapSnapshotPreviewHtml() {
  return '<p style="text-align:center;margin:18px 0;"><span style="display:inline-block;width:min(525px,100%);padding:44px 12px;border:1px solid #d6dde5;border-radius:8px;background:#eef3f7;color:#64748b;font:14px Arial,sans-serif;">Map snapshot preview</span></p>';
}

function emailHtmlPreviewDocument(email, body) {
  const theme = emailBrandTheme(email);
  const themeColor = emailThemeColor(email);
  const header =
    email.include_brand_images !== false
      ? `<div style="text-align:center;margin:0 0 18px 0;"><img src="${themeAssets[theme].logo}" alt="ADS-B Notifier" width="260" style="max-width:100%;height:auto;" /></div>`
      : "";
  const footer =
    email.include_brand_images !== false
      ? `<div style="text-align:center;margin:24px 0 0 0;"><img src="${themeAssets[theme].icon}" alt="" width="48" height="48" /></div>`
      : "";
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    body { margin: 0; padding: 18px; background: #f3f6f8; }
    a { color: ${themeColor}; }
  </style>
</head>
<body>
  <div style="font-family:Arial,sans-serif;line-height:1.4;color:#17202a;text-align:center;max-width:760px;margin:0 auto;background:#ffffff;border:1px solid #d6dde5;border-radius:8px;padding:22px;">
    ${header}
    ${body}
    ${footer}
  </div>
</body>
</html>`;
}

function emailBrandTheme(email) {
  const theme = String(email.brand_theme || "teal").trim().toLowerCase();
  return themeAssets[theme] ? theme : "teal";
}

function emailThemeColor(email) {
  return {
    amber: "#f59e0b",
    blue: "#0ea5e9",
    rose: "#f43f5e",
    teal: "#14b8a6",
    violet: "#8b5cf6",
  }[emailBrandTheme(email)];
}

function previewField(label, value) {
  const group = document.createElement("div");
  group.className = "notification-preview-field";
  const title = document.createElement("h3");
  title.textContent = label;
  const content = document.createElement("pre");
  content.textContent = value || "";
  group.append(title, content);
  return group;
}

function emailHtmlPreviewField(value) {
  const group = document.createElement("div");
  group.className = "notification-preview-field notification-html-preview-field";
  const header = document.createElement("div");
  header.className = "notification-preview-field-header";
  const title = document.createElement("h3");
  title.textContent = "HTML body";
  const controls = document.createElement("div");
  controls.className = "notification-preview-toggle";
  ["rendered", "source"].forEach((mode) => {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.emailHtmlPreviewMode = mode;
    button.classList.toggle("active", emailHtmlPreviewMode === mode);
    button.textContent = mode === "rendered" ? "Rendered" : "Source";
    button.addEventListener("click", () => {
      emailHtmlPreviewMode = mode;
      renderNotificationPreview();
    });
    controls.append(button);
  });
  header.append(title, controls);

  if (emailHtmlPreviewMode === "source") {
    const content = document.createElement("pre");
    content.textContent = value || "";
    group.append(header, content);
    return group;
  }

  const frame = document.createElement("iframe");
  frame.className = "notification-html-preview";
  frame.title = "Rendered HTML email preview";
  frame.setAttribute("sandbox", "");
  frame.srcdoc = value || "";
  group.append(header, frame);
  return group;
}

function previewEmpty(message) {
  const empty = document.createElement("p");
  empty.className = "empty-state";
  empty.textContent = message;
  return empty;
}

function numberOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function renderRuleList() {
  ruleList.replaceChildren();
  const rules = config?.rules || [];
  if (rules.length === 0) {
    ruleList.append(emptyState("No rules configured"));
    renderRuleBulkState();
    return;
  }

  const filteredRules = visibleRules();
  syncRuleSelectionToVisible();
  if (filteredRules.length === 0) {
    ruleList.append(emptyState("No rules match these filters"));
    renderRuleBulkState();
    return;
  }

  filteredRules.forEach((rule) => {
    const item = document.createElement("div");
    item.className = "rule-item";
    item.dataset.ruleId = rule.id;
    item.classList.toggle("selected", rule.id === selectedRuleId);
    item.classList.toggle("disabled", rule.enabled === false);
    item.classList.toggle("bulk-selected", selectedRuleIds.has(rule.id));

    const selectorLabel = document.createElement("label");
    selectorLabel.className = "rule-select";
    const selector = document.createElement("input");
    selector.type = "checkbox";
    selector.checked = selectedRuleIds.has(rule.id);
    selector.setAttribute("aria-label", `Select ${rule.name || "unnamed rule"} for bulk actions`);
    selectorLabel.append(selector);

    const button = document.createElement("button");
    button.className = "rule-open";
    button.type = "button";
    button.dataset.ruleId = rule.id;

    const title = document.createElement("strong");
    const status = document.createElement("span");
    status.className = "rule-status";
    status.textContent = rule.enabled === false ? "Disabled" : "Enabled";
    title.append(status, document.createTextNode(rule.name || "Unnamed rule"));
    const meta = document.createElement("span");
    meta.textContent = `${eventLabel(rule.event)} · ${ruleSummary(rule)} · ${rule.radius_miles ?? "unset"} mi`;
    button.append(title, meta);
    item.append(selectorLabel, button);
    ruleList.append(item);
  });
  renderRuleBulkState();
}

function renderRuleBulkState() {
  const selectedCount = selectedRuleIds.size;
  const visibleRuleIds = visibleRules().map((rule) => rule.id);
  const allVisibleSelected = visibleRuleIds.length > 0 && visibleRuleIds.every((ruleId) => selectedRuleIds.has(ruleId));
  ruleSelectedCount.textContent = `${selectedCount} selected`;
  toggleVisibleRulesButton.textContent = allVisibleSelected ? "Deselect visible" : "Select visible";
  toggleVisibleRulesButton.disabled = visibleRuleIds.length === 0;
  bulkEnableRulesButton.disabled = selectedCount === 0;
  bulkDisableRulesButton.disabled = selectedCount === 0;
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
  fields.ruleCooldown.value = rule.cooldown_minutes ?? DEFAULT_RULE_COOLDOWN_MINUTES;
  fields.ruleMinAltitude.value = rule.min_altitude_ft ?? "";
  fields.ruleMaxAltitude.value = rule.max_altitude_ft ?? "";
  fields.ruleTailNumbers.value = listToText(rule.tail_numbers);
  fields.ruleAircraftTypes.value = listToText(rule.aircraft_types);
  fields.ruleCategories.value = listToText(rule.categories);
  fields.ruleSquawkCodes.value = listToText(rule.squawk_codes);
  fields.ruleMilitary.checked = (rule.event || "tail") === "military";
  fields.ruleMilitary.disabled = true;
  fields.ruleIncludeTisb.checked = rule.include_tisb === true;
  fields.ruleHeadingChange.value = rule.circling_min_heading_change_deg ?? DEFAULT_CIRCLING_HEADING_CHANGE_DEG;
  fields.ruleWindowMinutes.value = rule.circling_window_minutes ?? DEFAULT_CIRCLING_WINDOW_MINUTES;
  fields.ruleQuietEnabled.checked = rule.quiet_hours?.enabled === true;
  fields.ruleQuietStart.value = rule.quiet_hours?.start || DEFAULT_QUIET_HOURS_START;
  fields.ruleQuietEnd.value = rule.quiet_hours?.end || DEFAULT_QUIET_HOURS_END;
  fields.ruleQuietTimeZone.value = rule.quiet_hours?.time_zone || browserTimeZone();
  fields.ruleExclusionTailNumbers.value = listToText(rule.exclusions?.tail_numbers);
  fields.ruleExclusionHexIds.value = listToText(rule.exclusions?.hex_ids);
  fields.ruleExclusionCallsigns.value = listToText(rule.exclusions?.callsigns);
  fields.ruleExclusionAircraftTypes.value = listToText(rule.exclusions?.aircraft_types);
  fields.ruleExclusionCategories.value = listToText(rule.exclusions?.categories);
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
  config.adsb_source = adsbSourceFromForms();
  config.backup_adsb_source = fields.backupSourceEnabled.checked ? adsbSourceFromFormFields({
    provider: fields.backupSourceProvider,
    query: fields.backupSourceQuery,
    radius: fields.backupSourceRadius,
    value: fields.backupSourceValue,
    baseUrl: fields.backupSourceBaseUrl,
  }) : null;
  config.home = {
    lat: numberValue(fields.homeLat),
    lon: numberValue(fields.homeLon),
  };
  config.poll_seconds = integerValue(fields.pollSeconds, DEFAULT_POLL_SECONDS);
  config.primary_retry_minutes = integerValue(fields.primaryRetryMinutes, DEFAULT_PRIMARY_RETRY_MINUTES);
  config.stale_aircraft_seconds = integerValue(fields.staleAircraftSeconds, DEFAULT_STALE_AIRCRAFT_SECONDS);
  config.recent_matches_window_hours = integerValue(fields.recentMatchesWindowHours, DEFAULT_RECENT_MATCHES_WINDOW_HOURS);
  config.source_health_trend_retention_hours = integerValue(
    fields.sourceHealthTrendRetentionHours,
    DEFAULT_SOURCE_HEALTH_TREND_RETENTION_HOURS
  );
  config.exclusions = exclusionsFromFields({
    tailNumbers: fields.globalExclusionTailNumbers,
    hexIds: fields.globalExclusionHexIds,
    callsigns: fields.globalExclusionCallsigns,
    aircraftTypes: fields.globalExclusionAircraftTypes,
    categories: fields.globalExclusionCategories,
  });
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
      include_map_snapshot: fields.emailIncludeMapSnapshot.checked,
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
    rule.squawk_codes = textToList(fields.ruleSquawkCodes.value);
    rule.notification_providers = selectedRuleNotificationProviders();
    rule.quiet_hours = {
      ...defaultQuietHours(),
      ...(rule.quiet_hours || {}),
      enabled: fields.ruleQuietEnabled.checked,
      start: fields.ruleQuietStart.value || DEFAULT_QUIET_HOURS_START,
      end: fields.ruleQuietEnd.value || DEFAULT_QUIET_HOURS_END,
      time_zone: fields.ruleQuietTimeZone.value.trim() || browserTimeZone(),
    };
    rule.exclusions = exclusionsFromFields({
      tailNumbers: fields.ruleExclusionTailNumbers,
      hexIds: fields.ruleExclusionHexIds,
      callsigns: fields.ruleExclusionCallsigns,
      aircraftTypes: fields.ruleExclusionAircraftTypes,
      categories: fields.ruleExclusionCategories,
    });
    rule.military = rule.event === "military";
    rule.include_tisb = fields.ruleIncludeTisb.checked;
    rule.circling_min_heading_change_deg = numberValue(fields.ruleHeadingChange);
    rule.circling_window_minutes = integerValue(fields.ruleWindowMinutes);
    pruneRuleForEvent(rule);
  }
}

function exclusionsFromFields(exclusionFields) {
  return {
    tail_numbers: textToList(exclusionFields.tailNumbers.value),
    hex_ids: textToList(exclusionFields.hexIds.value),
    callsigns: textToList(exclusionFields.callsigns.value),
    aircraft_types: textToList(exclusionFields.aircraftTypes.value),
    categories: textToList(exclusionFields.categories.value),
  };
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

function normalizeAdsbSource(source, adsbUrl = "", defaultProvider = "adsb_lol") {
  if (!source || source.provider === "direct") {
    return {
      provider: adsbUrl ? "direct" : defaultProvider,
      query: defaultProvider === "local_receiver" ? "url" : "point",
      radius_miles: "",
      value: "",
      base_url: "",
    };
  }
  return {
    provider: adsbSourceProviders.includes(source.provider) ? source.provider : defaultProvider,
    query: adsbSourceQueries.includes(source.query) ? source.query : "point",
    radius_miles: source.radius_miles ?? "",
    value: source.value || "",
    base_url: source.base_url || "",
  };
}

function adsbSourceFromForms() {
  return adsbSourceFromFormFields({
    provider: fields.adsbSourceProvider,
    query: fields.adsbSourceQuery,
    radius: fields.adsbSourceRadius,
    value: fields.adsbSourceValue,
    baseUrl: fields.adsbSourceBaseUrl,
  });
}

function adsbSourceFromFormFields(sourceFields) {
  const provider = sourceFields.provider.value;
  if (provider === "direct") {
    return {provider: "direct", query: "point"};
  }

  const source = {
    provider,
    query: sourceFields.query.value,
  };
  const radius = optionalNumberValue(sourceFields.radius);
  const value = sourceFields.value.value.trim();
  const baseUrl = sourceFields.baseUrl.value.trim();
  if (radius !== null) source.radius_miles = radius;
  if (value) source.value = value;
  if (baseUrl) source.base_url = baseUrl;
  return source;
}

function updateAdsbSourceFieldVisibility() {
  const provider = fields.adsbSourceProvider.value;
  syncSourceQueryForProvider(fields.adsbSourceProvider, fields.adsbSourceQuery);
  const query = fields.adsbSourceQuery.value;
  fields.adsbUrl.closest("label").classList.toggle("hidden", provider !== "direct");
  fields.adsbSourceQuery.disabled = provider === "direct";
  fields.adsbSourceRadius.disabled = provider === "direct" || query !== "point";
  fields.adsbSourceValue.disabled = provider === "direct" || !["reg", "type", "hex", "url", "file"].includes(query);
  fields.adsbSourceBaseUrl.disabled = provider === "direct" || provider === "local_receiver";
}

function updateBackupSourceFieldVisibility() {
  const enabled = fields.backupSourceEnabled.checked;
  const provider = fields.backupSourceProvider.value;
  syncSourceQueryForProvider(fields.backupSourceProvider, fields.backupSourceQuery);
  const query = fields.backupSourceQuery.value;
  fields.backupSourceProvider.disabled = !enabled;
  fields.backupSourceQuery.disabled = !enabled;
  fields.backupSourceRadius.disabled = !enabled || query !== "point";
  fields.backupSourceValue.disabled = !enabled || !["reg", "type", "hex", "url", "file"].includes(query);
  fields.backupSourceBaseUrl.disabled = !enabled || provider === "local_receiver";
}

function syncSourceQueryForProvider(providerField, queryField) {
  if (providerField.value === "local_receiver" && !["url", "file"].includes(queryField.value)) {
    queryField.value = "url";
  }
  if (providerField.value !== "local_receiver" && ["url", "file"].includes(queryField.value)) {
    queryField.value = "point";
  }
}

function optionalNumberValue(field) {
  const value = field.value.trim();
  if (value === "") return null;
  return Number.parseFloat(value);
}
