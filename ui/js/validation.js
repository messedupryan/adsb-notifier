function validateConfig(payload) {
  const errors = [];
  const source = payload.adsb_source || {};
  const sourceProvider = source.provider || "direct";
  if (!adsbSourceProviders.includes(sourceProvider)) {
    errors.push(validationError("ADS-B source provider is not supported.", fields.adsbSourceProvider));
  }
  if (sourceProvider === "direct" && !payload.adsb_url) {
    errors.push(validationError("ADS-B endpoint is required.", fields.adsbUrl));
  }
  if (sourceProvider !== "direct") {
    if (!adsbSourceQueries.includes(source.query)) {
      errors.push(validationError("ADS-B source query is not supported.", fields.adsbSourceQuery));
    }
    if (source.query === "point" && source.radius_miles !== undefined && !isRequiredNumber(source.radius_miles)) {
      errors.push(validationError("ADS-B source radius must be numeric when set.", fields.adsbSourceRadius));
    }
    if (source.query === "point" && Number(source.radius_miles) > MAX_ADSB_POINT_RADIUS_MILES) {
      errors.push(validationError(`ADS-B source radius cannot exceed ${MAX_ADSB_POINT_RADIUS_MILES} miles.`, fields.adsbSourceRadius));
    }
    if (["reg", "type", "hex"].includes(source.query) && !source.value) {
      errors.push(validationError("ADS-B source lookup value is required for this query.", fields.adsbSourceValue));
    }
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

function isSquawkCode(value) {
  return /^[0-7]{4}$/.test(String(value).trim());
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
    headingChange: fields.ruleHeadingChange,
    windowMinutes: fields.ruleWindowMinutes,
  }[key];
}
