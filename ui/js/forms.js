function renderForms() {
  if (!config) return;
  const notifications = config.notifications || {};
  const email = notifications.email || {};
  const pushover = notifications.pushover || {};
  const twilio = notifications.twilio || {};
  const source = normalizeAdsbSource(config.adsb_source, config.adsb_url);

  fields.adsbUrl.value = config.adsb_url || "";
  fields.adsbSourceProvider.value = source.provider;
  fields.adsbSourceQuery.value = source.query;
  fields.adsbSourceRadius.value = source.radius_miles ?? "";
  fields.adsbSourceValue.value = source.value || "";
  fields.adsbSourceBaseUrl.value = source.base_url || "";
  updateAdsbSourceFieldVisibility();
  fields.homeLat.value = config.home?.lat ?? "";
  fields.homeLon.value = config.home?.lon ?? "";
  fields.pollSeconds.value = config.poll_seconds ?? DEFAULT_POLL_SECONDS;
  fields.staleAircraftSeconds.value = config.stale_aircraft_seconds ?? DEFAULT_STALE_AIRCRAFT_SECONDS;
  fields.recentMatchesWindowHours.value = config.recent_matches_window_hours ?? DEFAULT_RECENT_MATCHES_WINDOW_HOURS;
  fields.globalExclusionTailNumbers.value = listToText(config.exclusions?.tail_numbers);
  fields.globalExclusionHexIds.value = listToText(config.exclusions?.hex_ids);
  fields.globalExclusionCallsigns.value = listToText(config.exclusions?.callsigns);
  fields.globalExclusionAircraftTypes.value = listToText(config.exclusions?.aircraft_types);

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
  config.home = {
    lat: numberValue(fields.homeLat),
    lon: numberValue(fields.homeLon),
  };
  config.poll_seconds = integerValue(fields.pollSeconds, DEFAULT_POLL_SECONDS);
  config.stale_aircraft_seconds = integerValue(fields.staleAircraftSeconds, DEFAULT_STALE_AIRCRAFT_SECONDS);
  config.recent_matches_window_hours = integerValue(fields.recentMatchesWindowHours, DEFAULT_RECENT_MATCHES_WINDOW_HOURS);
  config.exclusions = exclusionsFromFields({
    tailNumbers: fields.globalExclusionTailNumbers,
    hexIds: fields.globalExclusionHexIds,
    callsigns: fields.globalExclusionCallsigns,
    aircraftTypes: fields.globalExclusionAircraftTypes,
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

function normalizeAdsbSource(source, adsbUrl = "") {
  if (!source || source.provider === "direct") {
    return {
      provider: adsbUrl ? "direct" : "adsb_lol",
      query: "point",
      radius_miles: "",
      value: "",
      base_url: "",
    };
  }
  return {
    provider: adsbSourceProviders.includes(source.provider) ? source.provider : "adsb_lol",
    query: adsbSourceQueries.includes(source.query) ? source.query : "point",
    radius_miles: source.radius_miles ?? "",
    value: source.value || "",
    base_url: source.base_url || "",
  };
}

function adsbSourceFromForms() {
  const provider = fields.adsbSourceProvider.value;
  if (provider === "direct") {
    return {provider: "direct", query: "point"};
  }

  const source = {
    provider,
    query: fields.adsbSourceQuery.value,
  };
  const radius = optionalNumberValue(fields.adsbSourceRadius);
  const value = fields.adsbSourceValue.value.trim();
  const baseUrl = fields.adsbSourceBaseUrl.value.trim();
  if (radius !== null) source.radius_miles = radius;
  if (value) source.value = value;
  if (baseUrl) source.base_url = baseUrl;
  return source;
}

function updateAdsbSourceFieldVisibility() {
  const provider = fields.adsbSourceProvider.value;
  const query = fields.adsbSourceQuery.value;
  fields.adsbUrl.closest("label").classList.toggle("hidden", provider !== "direct");
  fields.adsbSourceQuery.disabled = provider === "direct";
  fields.adsbSourceRadius.disabled = provider === "direct" || query !== "point";
  fields.adsbSourceValue.disabled = provider === "direct" || !["reg", "type", "hex"].includes(query);
  fields.adsbSourceBaseUrl.disabled = provider === "direct";
}

function optionalNumberValue(field) {
  const value = field.value.trim();
  if (value === "") return null;
  return Number.parseFloat(value);
}
