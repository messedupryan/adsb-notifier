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
