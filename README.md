<p align="center">
  <img src="ui/images/logo_amber.png" alt="ADS-B Notifier" width="520" />
</p>

# ADS-B Notifier

ADS-B Notifier watches live aircraft data near a configured home location and sends notifications when saved rules match. It is intended for small personal or homelab deployments where you want to know when specific aircraft, aircraft types, or categories appear nearby.

The project is organized as three deployable components:

- **Worker**: polls ADS-B data, evaluates rules, sends notifications, and writes runtime status.
- **Configuration API**: validates, persists, backs up, and serves configuration and worker status.
- **Web UI**: manages settings, notification providers, rules, live rule tests, and recent matches.

The app can run locally during development or as containers in Kubernetes. See [Development Guide](docs/DEVELOPMENT.md) for setup, testing, container builds, and deployment commands.

## Contents

- [Features](#features)
- [UI](#ui)
- [Notification Providers](#notification-providers)
- [Architecture](#architecture)
- [Project Layout](#project-layout)
- [Configuration Overview](#configuration-overview)
- [Dashboard](#dashboard)
- [Development](#development)
- [Status](#status)

## Features

- Rule matching for tail numbers, callsigns, ICAO hex IDs, military aircraft, aircraft types, ADS-B categories, and circling behavior.
- Radius, minimum altitude, maximum altitude, stale-aircraft, and cooldown filters.
- Direct `aircraft.json` feed support for common dump1090/readsb/tar1090-style data.
- Online source adapters for Airplanes.live and ADSB.lol.
- HTTP rate-limit handling with `Retry-After` support and capped exponential backoff.
- Military matching that understands readsb/Airplanes.live `dbFlags`.
- Optional TIS-B inclusion for military rules.
- Per-rule notification provider selection from globally enabled providers.
- Live rule testing against the configured ADS-B source.
- Provider-specific notification templates.
- Worker status and recent match history.
- Dashboard map with home location, active rule radii, recent match markers, selected-match highlighting, and ADS-B Exchange aircraft links.
- Light/dark UI modes, accent themes, themed logo assets, and theme-aware favicon.

## UI

Screenshots will be added as the UI stabilizes. Useful examples to capture:

| View | What to Show |
| --- | --- |
| Dashboard overview | Worker summary across the top, recent matches on the left, and the alert map on the right. |
| Selected match map | A selected recent match highlighted in the list and on the map, with home location still visible. |
| Rule editor | A configured alert rule with radius, altitude, notification provider selection, and live rule test button. |
| Notification settings | Email, Pushover, and SMS provider sections with template fields visible but secrets hidden or redacted. |
| Appearance settings | Light/dark mode and accent theme controls showing the themed logo/icon behavior. |
| Mobile dashboard | Stacked dashboard layout on a narrow viewport. |

## Notification Providers

Current notification support includes:

- SMTP email
- Pushover push notifications
- Twilio SMS

Pushover is the recommended phone notification path for a small personal deployment because it avoids carrier SMS registration and compliance overhead. Twilio remains useful when actual SMS delivery is required.

## Architecture

```text
ADS-B source
    |
    v
Worker service
    | evaluates rules
    | sends notifications
    | writes status
    v
Shared config/status storage
    ^
    |
Configuration API <---- Web UI
```

In Kubernetes, the API owns persistence of the live configuration file and serves a redacted configuration view to the UI. The worker reads the live configuration file from shared storage and writes status so the UI can display operational state and recent matches.

## Project Layout

```text
adsb_notifier/        Python package for worker, API, parsing, rules, status, and notifiers
tests/                Python test suite
ui/                   Static web UI and no-cache development server
charts/adsb-notifier/ Helm chart for Kubernetes deployment
k8s/                  Raw Kubernetes manifests
docs/                 Development and operational documentation
config.example.json   Example configuration
Makefile              Common local, test, build, and deploy commands
```

## Configuration Overview

Configuration is JSON. The checked-in [config.example.json](config.example.json) shows the main structure:

- `home`: latitude and longitude used for distance calculations and map centering
- `poll_seconds`: worker polling interval
- `stale_aircraft_seconds`: ignore aircraft that have not been seen recently
- `recent_matches_window_hours`: how long recent matches remain in status history
- `adsb_url` or `adsb_source`: ADS-B source configuration
- `notifications`: provider configuration and templates
- `rules`: alert rules

Secrets can be referenced as environment variables with `env:NAME`, for example:

```json
"password": "env:SMTP_PASSWORD"
```

Rules support these event values:

- `tail`
- `military`
- `aircraft_type`
- `circling`

Example rule:

```json
{
  "name": "Tail number near home",
  "event": "tail",
  "tail_numbers": ["N12345"],
  "radius_miles": 25,
  "cooldown_minutes": 60,
  "notification_providers": ["pushover", "email"]
}
```

## Dashboard

The dashboard shows worker health, recent matches, and a map view. Recent matches include observed timestamps, aircraft metadata, notification provider selections, map positions when available, and ADS-B Exchange links.

The map is centered around the configured home location and can show:

- Home marker
- Active rule radii
- Recent alert markers
- Track direction hints
- Selected match highlighting

## Development

See [Development Guide](docs/DEVELOPMENT.md) for:

- Installing dependencies
- Running the API, UI, and worker locally
- Running tests
- Building container images
- Deploying with Helm
- Managing runtime secrets

## Status

This project is under active development. The current focus is turning the prototype into a reliable Kubernetes-hosted notifier with a practical dashboard, robust configuration handling, and a small set of notification providers that fit personal use.
