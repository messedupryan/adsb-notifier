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
  if (event.target.dataset.ruleControl) return;
  if (event.target === fields.json) {
    isJsonDirty = true;
    setDirty(true);
    clearMessage();
    return;
  }

  isJsonDirty = false;
  if (event.target === fields.adsbSourceProvider || event.target === fields.adsbSourceQuery) {
    updateAdsbSourceFieldVisibility();
    syncFromForms();
    renderJson();
  } else if (event.target === fields.ruleEvent) {
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

function applyRuleListFilters() {
  if (!config) return;
  syncRuleSelectionToVisible();
  renderRuleList();
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
