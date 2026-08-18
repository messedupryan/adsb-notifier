function emptyState(message) {
  const node = document.createElement("p");
  node.className = "empty-state";
  node.textContent = message;
  return node;
}

function activeRulesWithRadius() {
  return (config?.rules || []).filter((rule) => rule.enabled !== false && Number.isFinite(Number(rule.radius_miles)));
}

function recentMatchesWithPositions() {
  const matches = Array.isArray(filteredRecentMatches) ? filteredRecentMatches : [];
  return matches.filter((match) => hasPosition(match));
}

function selectedMatchWithPosition() {
  if (!selectedRecentMatchKey) return null;
  return recentMatchesWithPositions().find((match) => matchKey(match) === selectedRecentMatchKey) || null;
}

function dashboardMapZoom() {
  const radii = activeRulesWithRadius().map((rule) => Number(rule.radius_miles)).filter((radius) => radius > 0);
  const largestRadius = radii.length ? Math.max(...radii) : DEFAULT_DASHBOARD_MAP_RADIUS_MILES;
  if (largestRadius <= 2) return 13;
  if (largestRadius <= 5) return 12;
  if (largestRadius <= 15) return 11;
  return DEFAULT_DASHBOARD_MAP_ZOOM;
}

function hasPosition(match) {
  return Number.isFinite(Number(match.lat)) && Number.isFinite(Number(match.lon));
}

function milesToMeters(miles) {
  return Number(miles) * 1609.344;
}

function radiusBounds(lat, lon, radiusMiles) {
  const latitudeDelta = radiusMiles / 69;
  const longitudeMilesPerDegree = Math.max(1, 69 * Math.cos((lat * Math.PI) / 180));
  const longitudeDelta = radiusMiles / longitudeMilesPerDegree;
  return [
    [lat - latitudeDelta, lon - longitudeDelta],
    [lat + latitudeDelta, lon + longitudeDelta],
  ];
}

function eventColor(eventType) {
  return {
    tail: "#2563eb",
    military: "#be3455",
    aircraft_type: "#1f7a6d",
    squawk: "#7c3aed",
    circling: "#b45309",
  }[eventType] || currentAccentColor();
}

function currentAccentColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#1f7a6d";
}

function selectedMatchColor() {
  return "#dc2626";
}

function matchKey(match) {
  return [
    match.observed_at || "",
    match.rule_name || "",
    match.hex || "",
    match.aircraft_label || "",
  ].join("|");
}

function projectedTrackPoint(lat, lon, headingDeg, distanceMiles) {
  const earthRadiusMiles = 3958.7613;
  const angularDistance = distanceMiles / earthRadiusMiles;
  const heading = (headingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;
  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angularDistance) + Math.cos(lat1) * Math.sin(angularDistance) * Math.cos(heading)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(heading) * Math.sin(angularDistance) * Math.cos(lat1),
      Math.cos(angularDistance) - Math.sin(lat1) * Math.sin(lat2)
    );
  return [(lat2 * 180) / Math.PI, (lon2 * 180) / Math.PI];
}

function matchPopupHtml(match) {
  const title = `${match.rule_name || "Rule"}: ${match.aircraft_label || match.hex || "Aircraft"}`;
  const type = match.aircraft_type || match.category || "unknown type";
  const altitude = match.altitude_ft === null || match.altitude_ft === undefined ? "unknown altitude" : `${match.altitude_ft} ft`;
  const observed = formatDateTime(match.observed_at) || "Unknown time";
  const source = match.source_type ? ` · ${match.source_type}` : "";
  const airplanesLiveUrl = match.airplanes_live_url || match.adsb_exchange_url || "";
  const link = airplanesLiveUrl
    ? `<br /><a href="${escapeHtml(airplanesLiveUrl)}" target="_blank" rel="noopener noreferrer">Airplanes.live</a>`
    : "";
  return `
    <strong>${escapeHtml(title)}</strong><br />
    ${escapeHtml(type)} · ${escapeHtml(String(match.distance_miles ?? "unknown"))} mi · ${escapeHtml(altitude)}<br />
    ${escapeHtml(observed)}<br />
    ${escapeHtml(match.hex || "")}${escapeHtml(source)}
    ${link}
  `;
}

function matchExternalLink(match) {
  const link = document.createElement("a");
  const airplanesLiveUrl = match.airplanes_live_url || match.adsb_exchange_url || "";
  link.className = "external-match-link";
  link.textContent = "Airplanes.live";
  if (airplanesLiveUrl) {
    link.href = airplanesLiveUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
  } else {
    link.href = "#";
    link.setAttribute("aria-disabled", "true");
  }
  return link;
}
