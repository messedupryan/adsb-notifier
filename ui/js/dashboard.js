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
  workerStatusValue.textContent = sourceHealthLabel(status.status);
  workerStatusValue.className = `status-value ${statusClassName(status.status)}`;
  workerLastPoll.textContent = formatDateTime(status.last_poll_at) || "Never";
  workerAircraftCount.textContent = status.aircraft_count ?? "0";
  workerNotificationCount.textContent = status.notification_count ?? "0";
  workerAdsbSource.textContent = status.adsb_url || "Unknown";
  workerSourceErrors.textContent = status.consecutive_source_errors ?? "0";
  const retryAt = formatDateTime(status.rate_limit_retry_at);
  const backoffSeconds = Number(status.rate_limit_backoff_seconds || 0);
  workerRateLimitRetry.textContent = retryAt ? `${retryAt} (${backoffSeconds}s)` : "None";
  workerLastError.textContent = status.last_error || "None";
  renderSourceHealth(status);
  renderSourceHealthTrendSummary(status);
  renderNotificationPreview();

  recentMatches.replaceChildren();
  const matches = Array.isArray(status.recent_matches) ? status.recent_matches : [];
  renderDashboardFilters(matches);
  syncRecentMatchExportSelection(matches);
  filteredRecentMatches = filterRecentMatches(matches);
  if (matches.length === 0) {
    selectedRecentMatchKey = null;
    selectedRecentMatchExportKeys.clear();
    recentMatches.append(emptyState("No recent matches"));
    renderRecentMatchExportActions();
    renderDashboardMap(status);
    return;
  }
  if (selectedRecentMatchKey && !filteredRecentMatches.some((match) => matchKey(match) === selectedRecentMatchKey)) {
    updateMapActionState();
  }
  if (filteredRecentMatches.length === 0) {
    recentMatches.append(emptyState("No matches for current filters"));
    renderRecentMatchExportActions();
    renderDashboardMap(status);
    return;
  }
  renderRecentMatchGroups(filteredRecentMatches);
  renderRecentMatchExportActions();
  renderDashboardMap(status);
}

function renderSourceHealth(status) {
  const health = normalizedSourceHealth(status);
  workerSourceHealth.textContent = sourceHealthSummary(health);
  workerSourceHealth.className = `status-value ${statusClassName(health.status)}`;
  sourceHealthStatus.textContent = sourceHealthLabel(health.status);
  sourceHealthStatus.className = `source-health-value ${statusClassName(health.status)}`;
  sourceHealthProvider.textContent = sourceProviderLabel(health.provider);
  sourceHealthQuery.textContent = health.query || "Unknown";
  sourceHealthLastSuccess.textContent = formatDateTime(health.last_success_at) || "Never";
  sourceHealthLastFailure.textContent = formatDateTime(health.last_failure_at) || "Never";
  sourceHealthBackoff.textContent = health.backoff_seconds ? `${health.backoff_seconds}s` : "None";
  sourceHealthRetryAt.textContent = formatDateTime(health.retry_at) || "None";
  sourceHealthAircraftCount.textContent = health.last_aircraft_count ?? "0";
  sourceHealthLastError.textContent = health.last_error || "None";
}

function renderSourceHealthTrendSummary(status) {
  const trends = sourceHealthTrends(status);
  sourceHealthTrendsOpenButton.textContent = trends.length > 0 ? `Trends (${trends.length})` : "Trends";
}

function openSourceHealthTrendModal() {
  isSourceHealthTrendEventListVisible = false;
  renderSourceHealthTrendModal(latestWorkerStatus || {});
  sourceHealthTrendModal.classList.remove("hidden");
  sourceHealthTrendCloseButton.focus();
}

function closeSourceHealthTrendModal() {
  sourceHealthTrendModal.classList.add("hidden");
  sourceHealthTrendsOpenButton.focus();
}

function renderSourceHealthTrendModal(status) {
  const trends = sourceHealthTrends(status);
  const chartData = sourceHealthTrendChartData(trends);
  const retentionHours = status.source_health_trend_retention_hours ?? config?.source_health_trend_retention_hours;
  sourceHealthTrendSummary.textContent = trends.length
    ? `${trends.length} events retained${retentionHours ? ` for ${retentionHours} hours` : ""}.`
    : "No source health trend events have been recorded yet.";
  sourceHealthTrendChart.replaceChildren();
  sourceHealthTrendChart.append(sourceHealthTrendChartElement(chartData));
  sourceHealthTrendEventsToggle.textContent = isSourceHealthTrendEventListVisible ? "Hide events" : "Show events";
  sourceHealthTrendEventsToggle.disabled = trends.length === 0;
  sourceHealthTrendList.replaceChildren();
  sourceHealthTrendList.classList.toggle("hidden", !isSourceHealthTrendEventListVisible);
  if (trends.length === 0) {
    sourceHealthTrendList.append(emptyState("No trend events"));
    return;
  }
  trends.forEach((event) => sourceHealthTrendList.append(sourceHealthTrendItem(event)));
}

function toggleSourceHealthTrendEvents() {
  isSourceHealthTrendEventListVisible = !isSourceHealthTrendEventListVisible;
  renderSourceHealthTrendModal(latestWorkerStatus || {});
}

function sourceHealthTrendChartData(trends) {
  const events = trends
    .map((event) => ({...event, timestamp: sourceHealthTrendTimestamp(event)}))
    .filter((event) => event.timestamp !== null)
    .sort((left, right) => left.timestamp - right.timestamp);
  const points = events
    .filter((event) => event.event_type === "success" && Number.isFinite(Number(event.aircraft_count)))
    .map((event) => ({...event, aircraftCount: Number(event.aircraft_count)}));
  const failures = events.filter((event) => event.event_type === "failure");
  return {events, points, failures};
}

function sourceHealthTrendChartElement({events, points, failures}) {
  const wrapper = document.createElement("div");
  wrapper.className = "source-health-chart-shell";
  if (events.length === 0 || points.length === 0) {
    wrapper.append(emptyState(events.length === 0 ? "No trend events to chart" : "No aircraft-count samples yet"));
    return wrapper;
  }

  const width = 760;
  const height = 280;
  const padding = {top: 18, right: 20, bottom: 42, left: 54};
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  let minTime = events[0].timestamp;
  let maxTime = events[events.length - 1].timestamp;
  if (minTime === maxTime) {
    minTime -= 60_000;
    maxTime += 60_000;
  }
  const maxAircraftCount = Math.max(1, ...points.map((point) => point.aircraftCount));
  const x = (timestamp) => padding.left + ((timestamp - minTime) / (maxTime - minTime)) * plotWidth;
  const y = (count) => padding.top + plotHeight - (count / maxAircraftCount) * plotHeight;
  const svg = sourceHealthSvg("svg", {viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": "Aircraft found over time"});

  [0, Math.round(maxAircraftCount / 2), maxAircraftCount].forEach((tick) => {
    const tickY = y(tick);
    svg.append(sourceHealthSvg("line", {class: "source-health-chart-grid", x1: padding.left, y1: tickY, x2: width - padding.right, y2: tickY}));
    const label = sourceHealthSvg("text", {class: "source-health-chart-label", x: padding.left - 10, y: tickY + 4, "text-anchor": "end"});
    label.textContent = String(tick);
    svg.append(label);
  });

  failures.forEach((event) => {
    const marker = sourceHealthSvg("line", {
      class: `source-health-chart-failure ${statusClassName(event.status)}`,
      x1: x(event.timestamp),
      y1: padding.top,
      x2: x(event.timestamp),
      y2: padding.top + plotHeight,
    });
    const title = sourceHealthSvg("title");
    title.textContent = `${sourceHealthLabel(event.status)} at ${formatDateTime(event.observed_at) || event.observed_at}`;
    marker.append(title);
    svg.append(marker);
  });

  const path = points.map((point, index) => `${index === 0 ? "M" : "L"} ${x(point.timestamp).toFixed(1)} ${y(point.aircraftCount).toFixed(1)}`).join(" ");
  svg.append(sourceHealthSvg("path", {class: "source-health-chart-line", d: path}));
  points.forEach((point) => {
    const dot = sourceHealthSvg("circle", {
      class: "source-health-chart-point",
      cx: x(point.timestamp),
      cy: y(point.aircraftCount),
      r: 4,
    });
    const title = sourceHealthSvg("title");
    title.textContent = `${point.aircraftCount} aircraft at ${formatDateTime(point.observed_at) || point.observed_at}`;
    dot.append(title);
    svg.append(dot);
  });

  const startLabel = sourceHealthSvg("text", {class: "source-health-chart-label", x: padding.left, y: height - 12, "text-anchor": "start"});
  startLabel.textContent = formatDateTime(new Date(minTime).toISOString()) || "";
  const endLabel = sourceHealthSvg("text", {class: "source-health-chart-label", x: width - padding.right, y: height - 12, "text-anchor": "end"});
  endLabel.textContent = formatDateTime(new Date(maxTime).toISOString()) || "";
  svg.append(startLabel, endLabel);
  wrapper.append(svg, sourceHealthTrendLegend(failures.length));
  return wrapper;
}

function sourceHealthTrendLegend(failureCount) {
  const legend = document.createElement("div");
  legend.className = "source-health-chart-legend";
  const sample = document.createElement("span");
  sample.className = "source-health-chart-legend-line";
  const lineText = document.createElement("span");
  lineText.textContent = "Aircraft found";
  const failure = document.createElement("span");
  failure.className = "source-health-chart-legend-failure";
  const failureText = document.createElement("span");
  failureText.textContent = `${failureCount} failure marker${failureCount === 1 ? "" : "s"}`;
  legend.append(sample, lineText, failure, failureText);
  return legend;
}

function sourceHealthTrendTimestamp(event) {
  if (!event.observed_at) return null;
  const date = new Date(event.observed_at);
  const timestamp = date.getTime();
  return Number.isNaN(timestamp) ? null : timestamp;
}

function sourceHealthSvg(tagName, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tagName);
  Object.entries(attributes).forEach(([key, value]) => node.setAttribute(key, String(value)));
  return node;
}

function sourceHealthTrendItem(event) {
  const item = document.createElement("article");
  item.className = `source-health-trend-item ${statusClassName(event.status)}`;

  const header = document.createElement("div");
  header.className = "source-health-trend-item-header";
  const label = document.createElement("strong");
  label.textContent = sourceHealthTrendEventLabel(event.event_type);
  const time = document.createElement("time");
  time.textContent = formatDateTime(event.observed_at) || "Unknown time";
  if (event.observed_at) time.dateTime = event.observed_at;
  header.append(label, time);

  const meta = document.createElement("p");
  meta.textContent = [
    sourceHealthLabel(event.status),
    sourceProviderLabel(event.provider),
    event.query,
  ].filter(Boolean).join(" · ");

  item.append(header, meta);
  if (event.message) {
    const message = document.createElement("p");
    message.textContent = event.message;
    item.append(message);
  }

  const details = sourceHealthTrendDetails(event);
  if (details.length > 0) {
    const list = document.createElement("dl");
    list.className = "source-health-trend-details";
    details.forEach(([term, description]) => {
      const wrapper = document.createElement("div");
      const dt = document.createElement("dt");
      dt.textContent = term;
      const dd = document.createElement("dd");
      dd.textContent = description;
      wrapper.append(dt, dd);
      list.append(wrapper);
    });
    item.append(list);
  }
  return item;
}

function sourceHealthTrendDetails(event) {
  const details = [];
  if (event.backoff_seconds) details.push(["Backoff", `${event.backoff_seconds}s`]);
  if (event.retry_at) details.push(["Retry at", formatDateTime(event.retry_at) || event.retry_at]);
  if (event.consecutive_source_errors) details.push(["Consecutive errors", String(event.consecutive_source_errors)]);
  if (event.aircraft_count !== undefined) details.push(["Aircraft", String(event.aircraft_count)]);
  if (event.previous_provider) {
    details.push(["Previous source", [sourceProviderLabel(event.previous_provider), event.previous_query].filter(Boolean).join(" · ")]);
  }
  if (event.url) details.push(["URL", event.url]);
  return details;
}

function sourceHealthTrends(status) {
  return Array.isArray(status.source_health_trends) ? status.source_health_trends : [];
}

function sourceHealthTrendEventLabel(eventType) {
  return {
    success: "Success",
    failure: "Failure",
    rate_limit: "Rate limit",
    retry_backoff: "Retry/backoff",
    provider_switch: "Provider switch",
  }[eventType] || eventType || "Trend event";
}

function normalizedSourceHealth(status) {
  const health = status.source_health && typeof status.source_health === "object" ? status.source_health : {};
  return {
    status: health.status || status.status || "unknown",
    provider: health.provider || sourceProviderFromConfig() || "unknown",
    query: health.query || sourceQueryFromConfig() || "",
    last_success_at: health.last_success_at || status.last_poll_at || "",
    last_failure_at: health.last_failure_at || status.last_error_at || "",
    retry_at: health.retry_at || status.rate_limit_retry_at || "",
    backoff_seconds: health.backoff_seconds ?? status.rate_limit_backoff_seconds ?? 0,
    last_aircraft_count: health.last_aircraft_count ?? status.aircraft_count ?? 0,
    last_error: health.last_error ?? status.last_error ?? "",
    consecutive_source_errors: health.consecutive_source_errors ?? status.consecutive_source_errors ?? 0,
  };
}

function sourceHealthSummary(health) {
  const parts = [sourceHealthLabel(health.status), sourceProviderLabel(health.provider)];
  if (health.backoff_seconds) parts.push(`${health.backoff_seconds}s backoff`);
  if (health.consecutive_source_errors) parts.push(`${health.consecutive_source_errors} errors`);
  return parts.filter(Boolean).join(" · ");
}

function sourceHealthLabel(status) {
  return {
    ok: "Healthy",
    healthy: "Healthy",
    error: "Failing",
    failing: "Failing",
    source_unavailable: "Unavailable",
    rate_limited: "Rate limited",
    access_denied: "Access denied",
    unknown: "Unknown",
  }[status] || status || "Unknown";
}

function statusClassName(status) {
  return {
    ok: "healthy",
    healthy: "healthy",
    unknown: "unknown",
    rate_limited: "rate-limited",
    error: "failing",
    failing: "failing",
    source_unavailable: "failing",
    access_denied: "failing",
  }[status] || "unknown";
}

function sourceProviderLabel(provider) {
  return {
    adsb_lol: "ADSB.lol",
    airplanes_live: "Airplanes.live",
    direct: "Direct aircraft.json",
  }[provider] || provider || "Unknown";
}

function sourceProviderFromConfig() {
  return config?.adsb_source?.provider || (config?.adsb_url ? "direct" : "");
}

function sourceQueryFromConfig() {
  return config?.adsb_source?.query || (config?.adsb_url ? "aircraft_json" : "");
}

function renderRecentMatchGroups(matches) {
  groupRecentMatches(matches).slice(0, RECENT_MATCH_LIST_LIMIT).forEach((group) => {
    if (group.matches.length === 1) {
      recentMatches.append(renderRecentMatchItem(group.latest));
      return;
    }
    recentMatches.append(renderRecentMatchGroup(group));
    if (expandedMatchGroupKeys.has(group.key)) {
      group.matches.forEach((match) => recentMatches.append(renderRecentMatchItem(match, {nested: true})));
    }
  });
}

function renderRecentMatchGroup(group) {
  const item = document.createElement("div");
  item.className = "match-item match-group";
  item.classList.toggle("selected", group.matches.some((match) => matchKey(match) === selectedRecentMatchKey));
  item.role = "button";
  item.tabIndex = 0;
  item.dataset.matchKey = matchKey(group.latest);
  item.dataset.groupKey = group.key;

  const header = document.createElement("div");
  header.className = "match-group-header";
  if (isRecentMatchExportMode) {
    item.classList.add("export-mode");
    header.append(matchExportCheckbox(group.matches, `${group.ruleName}: ${group.aircraftLabel}`));
  }
  const title = document.createElement("strong");
  title.textContent = `${group.ruleName}: ${group.aircraftLabel}`;
  const count = document.createElement("span");
  count.className = "match-count";
  count.textContent = `${group.matches.length} alerts`;
  const toggle = document.createElement("button");
  toggle.className = "match-group-toggle";
  toggle.type = "button";
  toggle.dataset.groupKey = group.key;
  toggle.textContent = expandedMatchGroupKeys.has(group.key) ? "Hide" : "Show";
  header.append(title, count, toggle);

  const meta = document.createElement("span");
  const latestPosition = hasPosition(group.latestPosition)
    ? `${Number(group.latestPosition.lat).toFixed(4)}, ${Number(group.latestPosition.lon).toFixed(4)}`
    : "unknown position";
  meta.textContent = `${group.type} · ${group.distance} mi · latest ${latestPosition}`;

  const timeWindow = document.createElement("span");
  timeWindow.className = "match-time";
  timeWindow.textContent = `First ${formatDateTime(group.firstSeen) || "unknown"} · Last ${formatDateTime(group.lastSeen) || "unknown"}`;

  item.append(header, meta, notificationStatusLabel(group.latest), timeWindow, matchActions(matchExternalLink(group.latest), matchDetailButton(group.latest)));
  return item;
}

function renderRecentMatchItem(match, options = {}) {
  const key = matchKey(match);
  const item = document.createElement("div");
  item.className = "match-item";
  item.classList.toggle("nested", options.nested === true);
  item.classList.toggle("selected", key === selectedRecentMatchKey);
  item.role = "button";
  item.tabIndex = 0;
  item.dataset.matchKey = key;
  if (isRecentMatchExportMode) {
    item.classList.add("export-mode");
    item.append(matchExportCheckbox([match], match.aircraft_label || match.hex || "aircraft"));
  }
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
  item.append(title, meta, notificationStatusLabel(match), time);
  if (options.nested !== true) {
    item.append(matchActions(matchExternalLink(match), matchDetailButton(match)));
  }
  return item;
}

function matchExportCheckbox(matches, label) {
  const keys = matches.map(matchKey);
  const wrapper = document.createElement("label");
  wrapper.className = "match-export-select";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.dataset.exportMatchKeys = keys.join("\n");
  input.checked = keys.every((key) => selectedRecentMatchExportKeys.has(key));
  input.indeterminate = !input.checked && keys.some((key) => selectedRecentMatchExportKeys.has(key));
  input.setAttribute("aria-label", `Select ${label} for export`);
  wrapper.append(input);
  return wrapper;
}

function syncRecentMatchExportSelection(matches) {
  const availableKeys = new Set(matches.map(matchKey));
  selectedRecentMatchExportKeys = new Set(Array.from(selectedRecentMatchExportKeys).filter((key) => availableKeys.has(key)));
}

function renderRecentMatchExportActions() {
  const keys = Array.from(selectedRecentMatchExportKeys);
  const count = keys.length;
  toggleRecentExportButton.textContent = isRecentMatchExportMode ? "Done" : "Export";
  recentExportActions.classList.toggle("hidden", !isRecentMatchExportMode);
  recentExportSelectedCount.textContent = `${count} selected`;
  clearSelectedMatchesButton.disabled = count === 0;
  const hasVisibleMatches = filteredRecentMatches.length > 0;
  selectVisibleMatchesButton.disabled = !hasVisibleMatches;
  updateRecentMatchExportLink(exportSelectedJson, "json", keys);
  updateRecentMatchExportLink(exportSelectedCsv, "csv", keys);
}

function toggleRecentMatchExportMode() {
  isRecentMatchExportMode = !isRecentMatchExportMode;
  if (!isRecentMatchExportMode) {
    selectedRecentMatchExportKeys.clear();
  }
  if (latestWorkerStatus) {
    renderWorkerStatus(latestWorkerStatus);
  }
}

function updateRecentMatchExportLink(link, format, keys) {
  const disabled = keys.length === 0;
  link.href = disabled ? "#" : recentMatchExportUrl(format, keys);
  link.setAttribute("aria-disabled", String(disabled));
  link.tabIndex = disabled ? -1 : 0;
  link.classList.toggle("disabled", disabled);
}

function selectVisibleRecentMatchesForExport() {
  if (!latestWorkerStatus) return;
  filteredRecentMatches.forEach((match) => selectedRecentMatchExportKeys.add(matchKey(match)));
  renderWorkerStatus(latestWorkerStatus);
}

function clearRecentMatchExportSelection() {
  if (!latestWorkerStatus) return;
  selectedRecentMatchExportKeys.clear();
  renderWorkerStatus(latestWorkerStatus);
}

function matchActions(...actions) {
  const wrapper = document.createElement("div");
  wrapper.className = "match-actions";
  wrapper.append(...actions);
  return wrapper;
}

function matchDetailButton(match) {
  const button = document.createElement("button");
  button.className = "match-detail-button";
  button.type = "button";
  button.dataset.matchKey = matchKey(match);
  button.textContent = "Details";
  return button;
}

function notificationStatusLabel(match) {
  const status = document.createElement("span");
  status.className = `match-notification-status ${match.notification_status || "sent"}`;
  const suppressed = match.suppressed_notification_providers || [];
  if (match.notification_status === "suppressed") {
    status.textContent = `Notifications suppressed: ${suppressed.map(providerLabel).join(", ")}`;
  } else if (match.notification_status === "partially_suppressed") {
    status.textContent = `Phone alerts suppressed: ${suppressed.map(providerLabel).join(", ")}`;
  } else {
    status.textContent = `Notifications: ${(match.notification_providers || []).map(providerLabel).join(", ") || "none"}`;
  }
  return status;
}

function groupRecentMatches(matches) {
  const groups = new Map();
  matches.forEach((match) => {
    const key = matchGroupKey(match);
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(match);
  });
  return Array.from(groups.entries()).map(([key, groupMatches]) => {
    const sortedMatches = [...groupMatches].sort((a, b) => observedTimeMs(b) - observedTimeMs(a));
    const latest = sortedMatches[0];
    const oldest = sortedMatches[sortedMatches.length - 1];
    const latestPosition = sortedMatches.find(hasPosition) || latest;
    return {
      key,
      matches: sortedMatches,
      latest,
      latestPosition,
      firstSeen: oldest?.observed_at,
      lastSeen: latest?.observed_at,
      ruleName: latest.rule_name || "Rule",
      aircraftLabel: latest.aircraft_label || latest.registration || latest.hex || "Aircraft",
      type: latest.aircraft_type || latest.category || "unknown type",
      distance: latest.distance_miles ?? "unknown",
    };
  });
}

function matchGroupKey(match) {
  return [
    String(match.rule_name || "").trim().toLowerCase(),
    String(match.hex || match.registration || match.aircraft_label || "").trim().toLowerCase(),
  ].join("|");
}

function observedTimeMs(match) {
  const value = Date.parse(match?.observed_at || "");
  return Number.isFinite(value) ? value : 0;
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
  dashboardMap.fitBounds(bounds, {padding: [DASHBOARD_MAP_FIT_PADDING_PX, DASHBOARD_MAP_FIT_PADDING_PX], maxZoom, animate: false});
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
  dashboardMap.fitBounds(bounds, {padding: [SELECTED_MATCH_FIT_PADDING_PX, SELECTED_MATCH_FIT_PADDING_PX], maxZoom: 12, animate: false});
}

function updateMapActionState() {
  selectedMapButton.disabled = !selectedMatchWithPosition();
}

recentMatches.addEventListener("click", (event) => {
  if (event.target.closest("a")) return;
  const exportSelection = event.target.closest(".match-export-select input");
  if (exportSelection) {
    toggleRecentMatchExportSelection(exportSelection);
    return;
  }
  const detailButton = event.target.closest(".match-detail-button");
  if (detailButton?.dataset.matchKey) {
    openMatchDetail(detailButton.dataset.matchKey);
    return;
  }
  const toggle = event.target.closest(".match-group-toggle");
  if (toggle?.dataset.groupKey) {
    toggleMatchGroup(toggle.dataset.groupKey);
    return;
  }
  const item = event.target.closest(".match-item");
  if (!item?.dataset.matchKey) return;
  selectRecentMatch(item.dataset.matchKey);
});
recentMatches.addEventListener("keydown", (event) => {
  if (!["Enter", " "].includes(event.key)) return;
  if (event.target.closest(".match-export-select input")) return;
  if (event.target.closest(".match-detail-button")) return;
  if (event.target.closest(".match-group-toggle")) return;
  const item = event.target.closest(".match-item");
  if (!item?.dataset.matchKey) return;
  event.preventDefault();
  selectRecentMatch(item.dataset.matchKey);
});

[exportSelectedJson, exportSelectedCsv].forEach((link) => {
  link.addEventListener("click", (event) => {
    if (link.getAttribute("aria-disabled") !== "true") return;
    event.preventDefault();
  });
});

function toggleRecentMatchExportSelection(input) {
  const keys = (input.dataset.exportMatchKeys || "").split("\n").filter(Boolean);
  if (input.checked) {
    keys.forEach((key) => selectedRecentMatchExportKeys.add(key));
  } else {
    keys.forEach((key) => selectedRecentMatchExportKeys.delete(key));
  }
  renderWorkerStatus(latestWorkerStatus);
}

function toggleMatchGroup(key) {
  if (expandedMatchGroupKeys.has(key)) {
    expandedMatchGroupKeys.delete(key);
  } else {
    expandedMatchGroupKeys.add(key);
  }
  if (latestWorkerStatus) {
    renderWorkerStatus(latestWorkerStatus);
  }
}

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
    uniqueMatchValues(matches, (match) => [...(match.notification_providers || []), ...(match.suppressed_notification_providers || [])]),
    "All providers",
    providerLabel
  );
  syncFilterOptions(dashboardStatusFilter, uniqueMatchValues(matches, (match) => match.notification_status || "sent"), "All statuses", notificationStatusText);
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
  const notificationStatus = dashboardStatusFilter?.value || "";
  const search = (dashboardSearch?.value || "").trim().toLowerCase();
  return matches.filter((match) => {
    if (eventType && match.event_type !== eventType) return false;
    if (ruleName && match.rule_name !== ruleName) return false;
    if (notificationStatus && (match.notification_status || "sent") !== notificationStatus) return false;
    if (
      provider &&
      ![...(match.notification_providers || []), ...(match.suppressed_notification_providers || [])].includes(provider)
    ) {
      return false;
    }
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

function openMatchDetail(key) {
  const match = (latestWorkerStatus?.recent_matches || []).find((candidate) => matchKey(candidate) === key);
  if (!match) return;
  matchDetailTitle.textContent = `${match.rule_name || "Rule"}: ${match.aircraft_label || match.hex || "Aircraft"}`;
  const airplanesLiveUrl = match.airplanes_live_url || match.adsb_exchange_url || "";
  matchDetailLink.href = airplanesLiveUrl || "#";
  matchDetailLink.classList.toggle("hidden", !airplanesLiveUrl);
  matchDetailExportJson.href = recentMatchExportUrl("json", key);
  matchDetailExportCsv.href = recentMatchExportUrl("csv", key);
  renderMatchDetailSummary(match);
  matchDetailPayload.textContent = JSON.stringify(match.aircraft_payload || match, null, 2);
  matchDetailModal.classList.remove("hidden");
  matchDetailCloseButton.focus();
}

function recentMatchExportUrl(format, keys = []) {
  const selectedKeys = Array.isArray(keys) ? keys : [keys].filter(Boolean);
  const suffix = selectedKeys.length > 0 ? `?${selectedKeys.map((key) => `match_key=${encodeURIComponent(key)}`).join("&")}` : "";
  return `${apiBase}/recent-matches/export.${format}${suffix}`;
}

function renderMatchDetailSummary(match) {
  matchDetailSummary.replaceChildren();
  [
    ["Aircraft", match.aircraft_label || match.registration || match.hex || ""],
    ["Registration", match.registration || ""],
    ["Flight", match.flight || ""],
    ["ICAO hex", match.hex || ""],
    ["Aircraft type", match.aircraft_type || ""],
    ["Category", match.category || ""],
    ["Observed", formatDateTime(match.observed_at) || ""],
    ["Position", hasPosition(match) ? `${Number(match.lat).toFixed(4)}, ${Number(match.lon).toFixed(4)}` : ""],
    ["Distance", match.distance_miles === null || match.distance_miles === undefined ? "" : `${match.distance_miles} mi`],
    ["Altitude", match.altitude_ft === null || match.altitude_ft === undefined ? "" : `${match.altitude_ft} ft`],
    ["Speed", match.ground_speed_kt === null || match.ground_speed_kt === undefined ? "" : `${match.ground_speed_kt} kt`],
    ["Heading", match.track_deg === null || match.track_deg === undefined ? "" : `${match.track_deg} deg`],
    ["Vertical rate", match.vertical_rate_fpm === null || match.vertical_rate_fpm === undefined ? "" : `${match.vertical_rate_fpm} fpm`],
    ["Squawk", match.squawk || ""],
  ].forEach(([label, value]) => appendDetailRow(label, value || "unknown"));
}

function appendDetailRow(label, value) {
  const wrapper = document.createElement("div");
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  wrapper.append(term, description);
  matchDetailSummary.append(wrapper);
}

function closeMatchDetail() {
  matchDetailModal.classList.add("hidden");
}

function notificationStatusText(value) {
  return {
    sent: "Sent",
    suppressed: "Suppressed",
    partially_suppressed: "Partially suppressed",
  }[value] || value || "Unknown";
}
