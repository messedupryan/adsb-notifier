function initThemeControls() {
  const theme = readThemePreference();
  themeMode.value = theme.mode;
  themeAccent.value = theme.accent;
  applyTheme(theme);
  themeMode.addEventListener("change", () => saveThemePreference({mode: themeMode.value, accent: themeAccent.value}));
  themeAccent.addEventListener("change", () => saveThemePreference({mode: themeMode.value, accent: themeAccent.value}));
  window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
    if (themeMode.value === "system") {
      applyTheme({mode: "system", accent: themeAccent.value});
    }
  });
}

function readThemePreference() {
  try {
    return {...defaultTheme, ...JSON.parse(localStorage.getItem(themeStorageKey) || "{}")};
  } catch {
    return {...defaultTheme};
  }
}

function saveThemePreference(theme) {
  const nextTheme = {
    mode: ["light", "dark", "system"].includes(theme.mode) ? theme.mode : defaultTheme.mode,
    accent: ["teal", "blue", "amber", "rose", "violet"].includes(theme.accent) ? theme.accent : defaultTheme.accent,
  };
  localStorage.setItem(themeStorageKey, JSON.stringify(nextTheme));
  applyTheme(nextTheme);
}

function applyTheme(theme) {
  const resolvedMode =
    theme.mode === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : theme.mode === "dark" ? "dark" : "light";
  document.documentElement.dataset.mode = resolvedMode;
  document.documentElement.dataset.themeMode = theme.mode;
  document.documentElement.dataset.accent = theme.accent;
  const assets = themeAssets[theme.accent] || themeAssets.teal;
  appLogo.src = assets.logo;
  footerIcon.src = assets.icon;
  if (favicon) favicon.href = assets.icon;
  if (appleTouchIcon) appleTouchIcon.href = assets.icon;
}
