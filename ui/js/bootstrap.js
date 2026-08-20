versionLabel.textContent = `UI ${uiVersion}`;
fields.adsbSourceRadius.max = String(MAX_ADSB_POINT_RADIUS_MILES);
fields.recentMatchesWindowHours.max = String(MAX_RECENT_MATCHES_WINDOW_HOURS);
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
[dashboardEventFilter, dashboardRuleFilter, dashboardProviderFilter, dashboardSearch].forEach((control) => {
  control.addEventListener("input", applyDashboardFilters);
  control.addEventListener("change", applyDashboardFilters);
});
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
  if (input.dataset.dashboardControl) return;
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
