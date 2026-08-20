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
    squawk: "Squawk",
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
  if (rule.event === "squawk") return listToText(rule.squawk_codes) || "No squawk";
  if (rule.event === "military") return rule.include_tisb ? "Military + TIS-B" : "Military flag";
  if (rule.event === "circling") return `${rule.circling_min_heading_change_deg ?? DEFAULT_CIRCLING_HEADING_CHANGE_DEG} deg`;
  return `${rule.cooldown_minutes ?? DEFAULT_RULE_COOLDOWN_MINUTES} min`;
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
