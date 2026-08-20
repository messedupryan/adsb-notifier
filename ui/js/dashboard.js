async function loadWorkerStatus() {
  try {
    const response = await fetch(`${apiBase}/status`);
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.error || "Unable to load worker status");
    }
    renderWorkerStatus(payload);
  } catch (error) {
    renderWorkerStatus({status: "error", last_error: error.message || "Unable to load worker status", recent_matches: []});
  }
}

function renderWorkerStatus(status) {
  latestWorkerStatus = status;
  workerStatusValue.textContent = status.status || "unknown";
  workerLastPoll.textContent = formatDateTime(status.last_poll_at) || "Never";
  workerAircraftCount.textContent = status.aircraft_count ?? "0";
  workerNotificationCount.textContent = status.notification_count ?? "0";
  workerAdsbSource.textContent = status.adsb_url || "Unknown";
  workerSourceErrors.textContent = status.consecutive_source_errors ?? "0";
  const retryAt = formatDateTime(status.rate_limit_retry_at);
  const backoffSeconds = Number(status.rate_limit_backoff_seconds || 0);
  workerRateLimitRetry.textContent = retryAt ? `${retryAt} (${backoffSeconds}s)` : "None";
  workerLastError.textContent = status.last_error || "None";

  recentMatches.replaceChildren();
  const matches = Array.isArray(status.recent_matches) ? status.recent_matches : [];
  renderDashboardFilters(matches);
  filteredRecentMatches = filterRecentMatches(matches);
  if (matches.length === 0) {
    selectedRecentMatchKey = null;
    recentMatches.append(emptyState("No recent matches"));
    renderDashboardMap(status);
    return;
  }
  if (selectedRecentMatchKey && !filteredRecentMatches.some((match) => matchKey(match) === selectedRecentMatchKey)) {
    updateMapActionState();
  }
  if (filteredRecentMatches.length === 0) {
    recentMatches.append(emptyState("No matches for current filters"));
    renderDashboardMap(status);
    return;
  }
  filteredRecentMatches.slice(0, RECENT_MATCH_LIST_LIMIT).forEach((match) => {
    const key = matchKey(match);
    const item = document.createElement("div");
    item.className = "match-item";
    item.classList.toggle("selected", key === selectedRecentMatchKey);
    item.role = "button";
    item.tabIndex = 0;
    item.dataset.matchKey = key;
    const title = document.createElement("strong");
    title.textContent = `${match.rule_name || "Rule"}: ${match.aircraft_label || match.hex || "Aircraft"}`;
    const meta = document.createElement("span");
    const type = match.aircraft_type || "unknown type";
    const distance = match.distance_miles ?? "unknown";
    const altitude = match.altitude_ft === null || match.altitude_ft === undefined ? "unknown altitude" : `${match.altitude_ft} ft`;
    meta.textContent = `${type} · ${distance} mi · ${altitude}`;
    const time = document.createElement("span");
    time.className = "match-time";
    time.textContent = formatDateTime(match.observed_at) || "Unknown time";
    item.append(title, meta, time, matchExternalLink(match));
    recentMatches.append(item);
  });
  renderDashboardMap(status);
}

function renderDashboardMap(status) {
  if (!alertMap || !alertMapEmpty) return;
  const home = config?.home || {};
  const homeLat = Number(home.lat);
  const homeLon = Number(home.lon);
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) {
    alertMapEmpty.textContent = "Home location is not configured";
    alertMapEmpty.classList.remove("hidden");
    return;
  }
  if (!window.L) {
    alertMapEmpty.textContent = "Map library unavailable";
    alertMapEmpty.classList.remove("hidden");
    return;
  }

  const map = ensureDashboardMap(homeLat, homeLon);
  dashboardMapLayers.clearLayers();

  window.L.circleMarker([homeLat, homeLon], {
    radius: 7,
    color: "#17202a",
    fillColor: currentAccentColor(),
    fillOpacity: 1,
    weight: 2,
  })
    .bindPopup("Home")
    .addTo(dashboardMapLayers);

  activeRulesWithRadius().forEach((rule) => {
    window.L.circle([homeLat, homeLon], {
      radius: milesToMeters(rule.radius_miles),
      color: eventColor(rule.event),
      fillColor: eventColor(rule.event),
      fillOpacity: 0.04,
      weight: 1.5,
    })
      .bindPopup(`${escapeHtml(rule.name || "Rule")} · ${Number(rule.radius_miles).toFixed(1)} mi`)
      .addTo(dashboardMapLayers);
  });

  const matches = filteredRecentMatches.filter((match) => hasPosition(match));
  matches.slice(0, MAP_MATCH_MARKER_LIMIT).forEach((match) => {
    const latLng = [Number(match.lat), Number(match.lon)];
    const isSelected = matchKey(match) === selectedRecentMatchKey;
    const marker = window.L.circleMarker(latLng, {
      radius: isSelected ? SELECTED_MATCH_MARKER_RADIUS : DEFAULT_MATCH_MARKER_RADIUS,
      color: "#17202a",
      fillColor: isSelected ? selectedMatchColor() : eventColor(match.event_type),
      fillOpacity: isSelected ? 1 : 0.88,
      weight: isSelected ? SELECTED_MATCH_MARKER_WEIGHT : DEFAULT_MATCH_MARKER_WEIGHT,
    })
      .bindPopup(matchPopupHtml(match))
      .addTo(dashboardMapLayers);
    marker.on("click", () => selectRecentMatch(matchKey(match)));

    if (Number.isFinite(Number(match.track_deg))) {
      window.L
        .polyline(
          [latLng, projectedTrackPoint(Number(match.lat), Number(match.lon), Number(match.track_deg), TRACK_PROJECTION_DISTANCE_MILES)],
          {
            color: isSelected ? selectedMatchColor() : eventColor(match.event_type),
            opacity: isSelected ? 1 : 0.78,
            weight: isSelected ? SELECTED_TRACK_LINE_WEIGHT : DEFAULT_TRACK_LINE_WEIGHT,
          }
        )
        .addTo(dashboardMapLayers);
    }
  });

  alertMapEmpty.textContent = matches.length === 0 ? "No recent matches with positions" : "";
  alertMapEmpty.classList.toggle("hidden", matches.length > 0);
  updateMapActionState();
  // Fit after every redraw because Leaflet calculates bounds from current
  // container pixels; dashboard layout changes can otherwise leave stale sizing.
  fitDashboardMap({maxZoom: dashboardMapZoom()});
}

function ensureDashboardMap(homeLat, homeLon) {
  if (dashboardMap) return dashboardMap;
  dashboardMap = window.L.map(alertMap, {
    zoomControl: true,
    scrollWheelZoom: false,
  }).setView([homeLat, homeLon], 11);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
  }).addTo(dashboardMap);
  window.L.control.scale({imperial: true, metric: false}).addTo(dashboardMap);
  dashboardMapLayers = window.L.layerGroup().addTo(dashboardMap);
  return dashboardMap;
}

function recenterDashboardMap() {
  if (!dashboardMap || !config?.home) return;
  const homeLat = Number(config.home.lat);
  const homeLon = Number(config.home.lon);
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) return;

  const center = [homeLat, homeLon];
  const zoom = dashboardMapZoom();
  dashboardMap.invalidateSize();
  dashboardMap.setView(center, zoom, {animate: false});
  requestAnimationFrame(() => {
    dashboardMap.invalidateSize();
    dashboardMap.setView(center, zoom, {animate: false});
  });
}

function fitDashboardMap({maxZoom = 13} = {}) {
  if (!dashboardMap || !window.L || !config?.home) return;
  const homeLat = Number(config.home.lat);
  const homeLon = Number(config.home.lon);
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) return;

  const bounds = window.L.latLngBounds([[homeLat, homeLon]]);
  // Include rule radii as well as matched positions so initial zoom shows the
  // alert area, not just the latest aircraft cluster.
  activeRulesWithRadius().forEach((rule) => {
    bounds.extend(radiusBounds(homeLat, homeLon, Number(rule.radius_miles)));
  });
  recentMatchesWithPositions().forEach((match) => {
    bounds.extend([Number(match.lat), Number(match.lon)]);
  });

  dashboardMap.invalidateSize();
  dashboardMap.fitBounds(bounds, {padding: [28, 28], maxZoom, animate: false});
}

function zoomSelectedMatch() {
  if (!dashboardMap || !window.L || !config?.home) return;
  const match = selectedMatchWithPosition();
  if (!match) return;
  const homeLat = Number(config.home.lat);
  const homeLon = Number(config.home.lon);
  if (!Number.isFinite(homeLat) || !Number.isFinite(homeLon)) return;

  const bounds = window.L.latLngBounds([
    [homeLat, homeLon],
    [Number(match.lat), Number(match.lon)],
  ]);
  dashboardMap.invalidateSize();
  dashboardMap.fitBounds(bounds, {padding: [42, 42], maxZoom: 12, animate: false});
}

function updateMapActionState() {
  selectedMapButton.disabled = !selectedMatchWithPosition();
}

recentMatches.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const item = event.target.closest(".match-item");
  if (!item?.dataset.matchKey) return;
  selectRecentMatch(item.dataset.matchKey);
});
recentMatches.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  const item = event.target.closest(".match-item");
  if (!item?.dataset.matchKey) return;
  event.preventDefault();
  selectRecentMatch(item.dataset.matchKey);
});

function selectRecentMatch(key) {
  selectedRecentMatchKey = selectedRecentMatchKey === key ? null : key;
  if (latestWorkerStatus) {
    renderWorkerStatus(latestWorkerStatus);
  }
  updateMapActionState();
}

function renderDashboardFilters(matches) {
  syncFilterOptions(dashboardEventFilter, uniqueMatchValues(matches, (match) => match.event_type), "All events", eventLabel);
  syncFilterOptions(dashboardRuleFilter, uniqueMatchValues(matches, (match) => match.rule_name), "All rules");
  syncFilterOptions(
    dashboardProviderFilter,
    uniqueMatchValues(matches, (match) => match.notification_providers || []),
    "All providers",
    providerLabel
  );
}

function syncFilterOptions(select, values, allLabel, labelForValue = (value) => value) {
  if (!select) return;
  const currentValue = select.value;
  select.replaceChildren(new Option(allLabel, ""));
  values.forEach((value) => select.append(new Option(labelForValue(value), value)));
  select.value = values.includes(currentValue) ? currentValue : "";
}

function uniqueMatchValues(matches, valueForMatch) {
  const values = new Set();
  matches.forEach((match) => {
    const value = valueForMatch(match);
    const items = Array.isArray(value) ? value : [value];
    items.forEach((item) => {
      const normalized = String(item || "").trim();
      if (normalized) values.add(normalized);
    });
  });
  return Array.from(values).sort((a, b) => a.localeCompare(b));
}

function filterRecentMatches(matches) {
  const eventType = dashboardEventFilter?.value || "";
  const ruleName = dashboardRuleFilter?.value || "";
  const provider = dashboardProviderFilter?.value || "";
  const search = (dashboardSearch?.value || "").trim().toLowerCase();
  return matches.filter((match) => {
    if (eventType && match.event_type !== eventType) return false;
    if (ruleName && match.rule_name !== ruleName) return false;
    if (provider && !(match.notification_providers || []).includes(provider)) return false;
    return !search || matchSearchText(match).includes(search);
  });
}

function matchSearchText(match) {
  return [
    match.rule_name,
    match.event_type,
    match.aircraft_label,
    match.registration,
    match.flight,
    match.hex,
    match.aircraft_type,
    match.category,
    match.squawk,
    match.source_type,
  ]
    .filter((value) => value !== null && value !== undefined)
    .join(" ")
    .toLowerCase();
}

function applyDashboardFilters() {
  if (latestWorkerStatus) {
    renderWorkerStatus(latestWorkerStatus);
  }
}
