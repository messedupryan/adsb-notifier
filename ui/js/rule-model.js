function createRule(eventType) {
  const base = {
    id: createClientRuleId(),
    name: uniqueRuleName(`New ${eventLabel(eventType).toLowerCase()} rule`),
    event: eventType,
    enabled: true,
    radius_miles: DEFAULT_RULE_RADIUS_MILES,
    cooldown_minutes: DEFAULT_RULE_COOLDOWN_MINUTES,
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
      circling_min_heading_change_deg: DEFAULT_CIRCLING_HEADING_CHANGE_DEG,
      circling_window_minutes: DEFAULT_CIRCLING_WINDOW_MINUTES,
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

function normalizeConfig(payload) {
  return normalizeRuleNotificationProviders({
    ...payload,
    config_revision: Number(payload.config_revision) || 1,
    adsb_url: payload.adsb_url || "",
    adsb_source: payload.adsb_source || null,
    home: {
      lat: payload.home?.lat ?? "",
      lon: payload.home?.lon ?? "",
    },
    poll_seconds: payload.poll_seconds ?? DEFAULT_POLL_SECONDS,
    stale_aircraft_seconds: payload.stale_aircraft_seconds ?? DEFAULT_STALE_AIRCRAFT_SECONDS,
    recent_matches_window_hours: payload.recent_matches_window_hours ?? DEFAULT_RECENT_MATCHES_WINDOW_HOURS,
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
