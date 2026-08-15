function confirmAction({title, message, acceptLabel = "Continue", cancelLabel = "Cancel", destructive = false}) {
  if (confirmResolver) closeConfirm(false);
  confirmReturnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  confirmTitle.textContent = title;
  confirmMessage.textContent = message;
  confirmCancelButton.textContent = cancelLabel;
  confirmAcceptButton.textContent = acceptLabel;
  confirmAcceptButton.classList.toggle("danger", destructive);
  confirmModal.classList.remove("hidden");
  confirmCancelButton.focus();
  return new Promise((resolve) => {
    confirmResolver = resolve;
  });
}

function closeConfirm(result) {
  if (!confirmResolver) return;
  const resolve = confirmResolver;
  confirmResolver = null;
  confirmModal.classList.add("hidden");
  confirmAcceptButton.classList.remove("danger");
  if (confirmReturnFocus) {
    confirmReturnFocus.focus();
  }
  confirmReturnFocus = null;
  resolve(result);
}

function commitCurrentView() {
  if (isJsonDirty) {
    return syncFromJson();
  }
  commitForms();
  return true;
}

function commitForms() {
  syncFromForms();
  renderJson();
}

function writeHeaders() {
  return {
    "Content-Type": "application/json",
    "If-Match": String(savedConfig?.config_revision ?? config?.config_revision ?? 1),
  };
}
