versionLabel.textContent = `UI ${uiVersion}`;
fields.adsbSourceRadius.max = String(MAX_ADSB_POINT_RADIUS_MILES);
fields.recentMatchesWindowHours.max = String(MAX_RECENT_MATCHES_WINDOW_HOURS);
fields.sourceHealthTrendRetentionHours.max = String(MAX_SOURCE_HEALTH_TREND_RETENTION_HOURS);
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
toggleVisibleRulesButton.addEventListener("click", toggleVisibleRuleSelection);
bulkEnableRulesButton.addEventListener("click", () => bulkSetSelectedRulesEnabled(true));
bulkDisableRulesButton.addEventListener("click", () => bulkSetSelectedRulesEnabled(false));
testEmailButton.addEventListener("click", () => testNotification("email"));
testPushoverButton.addEventListener("click", () => testNotification("pushover"));
testTwilioButton.addEventListener("click", () => testNotification("twilio"));
notificationProviderSelector.addEventListener("click", (event) => {
  const button = event.target.closest("[data-notification-provider]");
  if (!button) return;
  selectNotificationProvider(button.dataset.notificationProvider);
});
refreshStatusButton.addEventListener("click", () => loadWorkerStatus());
sourceHealthTrendsOpenButton.addEventListener("click", openSourceHealthTrendModal);
toggleRecentExportButton.addEventListener("click", toggleRecentMatchExportMode);
selectVisibleMatchesButton.addEventListener("click", selectVisibleRecentMatchesForExport);
clearSelectedMatchesButton.addEventListener("click", clearRecentMatchExportSelection);
recenterMapButton.addEventListener("click", () => recenterDashboardMap());
fitMapButton.addEventListener("click", () => fitDashboardMap());
selectedMapButton.addEventListener("click", () => zoomSelectedMatch());
[dashboardEventFilter, dashboardRuleFilter, dashboardProviderFilter, dashboardStatusFilter, dashboardSearch].forEach((control) => {
  control.addEventListener("input", applyDashboardFilters);
  control.addEventListener("change", applyDashboardFilters);
});
fields.ruleNotificationProviders.addEventListener("change", handleInput);
[
  ruleSearch,
  ruleTypeFilter,
  ruleStateFilter,
].forEach((control) => {
  control.addEventListener("input", applyRuleListFilters);
  control.addEventListener("change", applyRuleListFilters);
});
ruleList.addEventListener("click", async (event) => {
  const selection = event.target.closest(".rule-select input");
  if (selection) {
    const item = selection.closest(".rule-item");
    const ruleId = item?.dataset.ruleId;
    if (!ruleId) return;
    if (selection.checked) {
      selectedRuleIds.add(ruleId);
    } else {
      selectedRuleIds.delete(ruleId);
    }
    renderRuleList();
    return;
  }

  const item = event.target.closest(".rule-open");
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
  if (input.dataset.dashboardControl) return;
  if (input.dataset.ruleControl) return;
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
matchDetailCloseButton.addEventListener("click", closeMatchDetail);
sourceHealthTrendCloseButton.addEventListener("click", closeSourceHealthTrendModal);
confirmModal.addEventListener("click", (event) => {
  if (event.target === confirmModal) closeConfirm(false);
});
matchDetailModal.addEventListener("click", (event) => {
  if (event.target === matchDetailModal) closeMatchDetail();
});
sourceHealthTrendModal.addEventListener("click", (event) => {
  if (event.target === sourceHealthTrendModal) closeSourceHealthTrendModal();
});
window.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!confirmModal.classList.contains("hidden")) closeConfirm(false);
  if (!matchDetailModal.classList.contains("hidden")) closeMatchDetail();
  if (!sourceHealthTrendModal.classList.contains("hidden")) closeSourceHealthTrendModal();
});
window.addEventListener("error", (event) => {
  showErrors([`UI error: ${event.message}`]);
});
window.addEventListener("unhandledrejection", (event) => {
  showErrors([`UI error: ${event.reason?.message || event.reason || "Unhandled promise rejection"}`]);
});

loadConfig();
loadWorkerStatus();
