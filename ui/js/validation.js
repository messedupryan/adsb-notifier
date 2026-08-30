function validateConfig(payload) {
  const errors = [];
  const source = payload.adsb_source || {};
  const sourceProvider = source.provider || "direct";
  errors.push(...validateSourceConfig(source, sourceProvider, {
    provider: fields.adsbSourceProvider,
    query: fields.adsbSourceQuery,
    radius: fields.adsbSourceRadius,
    value: fields.adsbSourceValue,
    baseUrl: fields.adsbSourceBaseUrl,
  }));
  if (sourceProvider === "direct" && !payload.adsb_url) {
    errors.push(validationError("ADS-B endpoint is required.", fields.adsbUrl));
  }
  if (payload.backup_adsb_source) {
    errors.push(...validateSourceConfig(payload.backup_adsb_source, payload.backup_adsb_source.provider, {
      provider: fields.backupSourceProvider,
      query: fields.backupSourceQuery,
      radius: fields.backupSourceRadius,
      value: fields.backupSourceValue,
      baseUrl: fields.backupSourceBaseUrl,
      allowedProviders: backupAdsbSourceProviders,
      label: "Backup ADS-B source",
    }));
  }
  if (!isRequiredNumber(payload.primary_retry_minutes) || Number(payload.primary_retry_minutes) < 1) {
    errors.push(validationError("Primary retry minutes must be at least 1.", fields.primaryRetryMinutes));
  }
  if (!isRequiredNumber(payload.home?.lat) || !isRequiredNumber(payload.home?.lon)) {
    errors.push(validationError("Home latitude and longitude are required.", [fields.homeLat, fields.homeLon]));
  }
  if (!isRequiredNumber(payload.recent_matches_window_hours)) {
    errors.push(validationError("Recent matches hours is required.", fields.recentMatchesWindowHours));
  } else if (
    Number(payload.recent_matches_window_hours) < 1 ||
    Number(payload.recent_matches_window_hours) > MAX_RECENT_MATCHES_WINDOW_HOURS
  ) {
    errors.push(
      validationError(`Recent matches hours must be between 1 and ${MAX_RECENT_MATCHES_WINDOW_HOURS}.`, fields.recentMatchesWindowHours)
    );
  }
  if (!isRequiredNumber(payload.source_health_trend_retention_hours)) {
    errors.push(validationError("Source health trend hours is required.", fields.sourceHealthTrendRetentionHours));
  } else if (
    Number(payload.source_health_trend_retention_hours) < 1 ||
    Number(payload.source_health_trend_retention_hours) > MAX_SOURCE_HEALTH_TREND_RETENTION_HOURS
  ) {
    errors.push(
      validationError(
        `Source health trend hours must be between 1 and ${MAX_SOURCE_HEALTH_TREND_RETENTION_HOURS}.`,
        fields.sourceHealthTrendRetentionHours
      )
    );
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
    if (rule.event === "squawk") {
      const squawkCodes = Array.isArray(rule.squawk_codes) ? rule.squawk_codes : [];
      if (squawkCodes.length === 0) {
        errors.push(ruleValidationError(`${label} needs at least one squawk code.`, rule, "squawkCodes"));
      } else if (squawkCodes.some((code) => !isSquawkCode(code))) {
        errors.push(ruleValidationError(`${label} squawk codes must use four digits from 0-7.`, rule, "squawkCodes"));
      }
    }
    if (rule.event === "circling" && !isRequiredNumber(rule.circling_min_heading_change_deg)) {
      errors.push(ruleValidationError(`${label} needs a heading change threshold.`, rule, "headingChange"));
    }
    if (rule.event === "circling" && !isRequiredNumber(rule.circling_window_minutes)) {
      errors.push(ruleValidationError(`${label} needs a circling window.`, rule, "windowMinutes"));
    }
    if (rule.quiet_hours?.enabled === true) {
      if (!isTimeOfDay(rule.quiet_hours.start)) {
        errors.push(ruleValidationError(`${label} quiet hours need a valid start time.`, rule, "quietStart"));
      }
      if (!isTimeOfDay(rule.quiet_hours.end)) {
        errors.push(ruleValidationError(`${label} quiet hours need a valid end time.`, rule, "quietEnd"));
      }
      if (rule.quiet_hours.start === rule.quiet_hours.end) {
        errors.push(ruleValidationError(`${label} quiet hours start and end must differ.`, rule, ["quietStart", "quietEnd"]));
      }
      if (!String(rule.quiet_hours.time_zone || "").trim()) {
        errors.push(ruleValidationError(`${label} quiet hours need a timezone.`, rule, "quietTimeZone"));
      }
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

function validateSourceConfig(source, sourceProvider, targets) {
  const errors = [];
  const allowedProviders = targets.allowedProviders || adsbSourceProviders;
  const label = targets.label || "ADS-B source";
  if (!allowedProviders.includes(sourceProvider)) {
    errors.push(validationError(`${label} provider is not supported.`, targets.provider));
    return errors;
  }
  if (sourceProvider === "direct") return errors;
  if (!adsbSourceQueries.includes(source.query)) {
    errors.push(validationError(`${label} query is not supported.`, targets.query));
  }
  if (sourceProvider === "local_receiver" && !["url", "file"].includes(source.query)) {
    errors.push(validationError(`${label} local receiver query must be URL or file.`, targets.query));
  }
  if (sourceProvider !== "local_receiver" && ["url", "file"].includes(source.query)) {
    errors.push(validationError(`${label} URL/file queries require local receiver.`, targets.query));
  }
  if (source.query === "point" && source.radius_miles !== undefined && !isRequiredNumber(source.radius_miles)) {
    errors.push(validationError(`${label} radius must be numeric when set.`, targets.radius));
  }
  if (source.query === "point" && Number(source.radius_miles) > MAX_ADSB_POINT_RADIUS_MILES) {
    errors.push(validationError(`${label} radius cannot exceed ${MAX_ADSB_POINT_RADIUS_MILES} miles.`, targets.radius));
  }
  if (["reg", "type", "hex", "url", "file"].includes(source.query) && !source.value) {
    errors.push(validationError(`${label} value is required for this query.`, targets.value));
  }
  return errors;
}

function isRequiredNumber(value) {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function isSquawkCode(value) {
  return /^[0-7]{4}$/.test(String(value).trim());
}

function isTimeOfDay(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(String(value).trim());
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
    squawkCodes: fields.ruleSquawkCodes,
    notificationProviders: fields.ruleNotificationProviders,
    quietStart: fields.ruleQuietStart,
    quietEnd: fields.ruleQuietEnd,
    quietTimeZone: fields.ruleQuietTimeZone,
    headingChange: fields.ruleHeadingChange,
    windowMinutes: fields.ruleWindowMinutes,
  }[key];
}
