# ADS-B Notifier

ADS-B Notifier watches aircraft near a configured home location and sends alerts when saved rules match live ADS-B data. It is built as three Kubernetes-friendly components:

- Worker service that polls ADS-B aircraft JSON and sends notifications
- Configuration API that validates and persists runtime config
- Web UI for editing the shared configuration and reviewing recent matches on a map

The app can run locally for development or as three containers in Kubernetes. The Kubernetes deployment is managed by Helm and currently uses:

- Namespace: `adsb`
- Release: `adsb-notifier`
- Local registry: `pi-lab-registry.local`
- Test URL: `http://adsb-notifier.10.0.0.100.sslip.io/`

Current UI version: `UI 20260809-12`

## Supported Events

- Specific tail number, callsign, or ICAO hex near home
- Optional minimum and maximum altitude filters
- Military aircraft near home, using explicit military flags or readsb/Airplanes.live `dbFlags`
- Specific aircraft type or ADS-B category
- Circling pattern detection based on accumulated heading changes inside a radius

The service works with common `dump1090`, `readsb`, and `tar1090` JSON feeds that expose `aircraft.json`, and can also build online source URLs for Airplanes.live and ADSB.lol.

## Dashboard

The UI Dashboard shows:

- Worker health, last poll time, aircraft count, notification count, ADS-B source, rate-limit retry status, and last error
- Recent matches with observed timestamps and ADS-B Exchange links
- Alert map with home marker, active rule radii, recent match markers, selected-match highlighting, and Home/Fit Alerts/Selected controls

The worker summary spans the top of the dashboard. Recent matches sit to the left of the map and scroll independently on desktop so the map remains visible as the list grows. The site also has a favicon; the default tab icon is teal and the UI swaps it to match the selected accent theme when the app loads.

## Local Development

Common project workflows are wrapped in the root `Makefile`:

```bash
make help
make test
make local
make build-push
make deploy-k8s
make deploy-helm HELM_CHART=charts/adsb-notifier
```

Install dependencies:

```bash
pipenv install --dev
cp config.example.json config.dev.json
```

Run API and UI together:

```bash
make local LOCAL_CONFIG=config.dev.json
```

Open:

```text
http://127.0.0.1:8766/?api=http://127.0.0.1:8765
```

Run components separately:

```bash
make local-api LOCAL_CONFIG=config.dev.json
make local-ui
```

Run a single worker poll:

```bash
make worker-once LOCAL_CONFIG=config.dev.json
```

Run tests:

```bash
make test
```

Direct commands are also available:

```bash
pipenv run adsb-notifier-api --config config.dev.json --host 127.0.0.1 --port 8765 --status-file status.json --backup-retention 20
cd ui && UI_HOST=127.0.0.1 UI_PORT=8766 pipenv run python dev_server.py
pipenv run adsb-notifier --config config.dev.json --status-file status.json --once
pipenv run pytest -q
```

The API writes config snapshots to a `backups/` directory beside the active config before overwrites. `--backup-retention` controls how many snapshots to keep; use `0` to disable backups.

Run a single poll against a local or port-forwarded ADS-B feed without editing config:

```bash
pipenv run adsb-notifier --config config.dev.json --adsb-url http://127.0.0.1:8080/tar1090/data/aircraft.json --once
```

For new changes:

- Use `pipenv run ...` or the Makefile targets so commands run inside the project environment.
- Bump `uiVersion` in `ui/app.js` when changing UI assets or behavior.
- Update `ui/index.html` asset query strings when bumping the UI version.
- Keep `README.md`, `config.example.json`, and Helm `seedConfig` aligned when adding config fields.
- Run `make test` before building or deploying.

## Browser URLs

Local UI:

```text
http://127.0.0.1:8766/?api=http://127.0.0.1:8765
```

Kubernetes UI:

```text
http://adsb-notifier.10.0.0.100.sslip.io/
```

Kubernetes status API:

```text
http://adsb-notifier.10.0.0.100.sslip.io/api/status
```


## Configuration

`config.example.json` contains example rules and notification blocks. Secrets can be referenced with `env:NAME`, for example:

```json
"password": "env:SMTP_PASSWORD"
```

Rules use these event values:

- `tail`
- `military`
- `aircraft_type`
- `circling`

Rules are assigned stable `id` values by the config API. Existing configs without rule IDs are backfilled automatically.

Rules can choose which globally enabled notification providers they use with `notification_providers`. Providers are selected per rule from the global notification types that are enabled. If a provider is disabled globally, the API removes it from every rule's selection the next time config is read or saved.

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

Military rules default to requiring the ADS-B source to mark the aircraft as military. Airplanes.live/readsb-style payloads can identify this through `dbFlags: 1`; the parser normalizes that into `military: true`. Military rules can optionally include TIS-B/other tracks with `include_tisb: true`.

```json
{
  "name": "Military nearby",
  "event": "military",
  "military": true,
  "include_tisb": false,
  "radius_miles": 40,
  "max_altitude_ft": 25000,
  "cooldown_minutes": 30,
  "notification_providers": ["email"]
}
```

`recent_matches_window_hours` controls how long recent matches are retained in worker status. The default is `24`, and the maximum is `168`.

ADS-B data can come from a direct `aircraft.json` URL or from an online source adapter. The direct URL remains available through `adsb_url`; an `adsb_source` block enables provider-specific URL construction:

```json
"adsb_source": {
  "provider": "airplanes_live",
  "query": "point",
  "radius_miles": 40
}
```

Supported providers are `airplanes_live` and `adsb_lol`. Supported query modes are:

- `point`: uses configured home latitude/longitude and either `radius_miles` or the largest enabled rule radius
- `reg`: searches by registration
- `type`: searches by aircraft type
- `hex`: searches by ICAO hex
- `mil`: uses the provider's military endpoint

Keep polling at `60-120` seconds for online public APIs. The worker treats HTTP `429` responses as rate limits, honors `Retry-After` when present, and otherwise uses capped exponential backoff.

## Configuration API

Implemented:

- `GET /healthz`
- `GET /status`
- `GET /config`
- `PUT /config`
- `GET /rules`
- `POST /rules`
- `PUT /rules/{id}`
- `DELETE /rules/{id}`
- `POST /rules/{id}/test`
- `POST /notifications/test`

The UI uses the rule-specific endpoints for rule create, update, duplicate, and delete workflows. The full-config endpoint remains available for settings, notification blocks, raw JSON edits, and worker config loading.

`POST /rules/{id}/test` fetches the current ADS-B source, evaluates only that saved rule with its real parameters, and sends notifications only when live aircraft match. If no aircraft match, the response reports `matched: false` and no notifications are sent.

The worker writes operational status to `status.json` after each poll. The API serves that file through `GET /status`, and the UI Dashboard tab shows the last poll timestamp, aircraft count, notification count, ADS-B source, rate-limit retry timing, last error, and recent matches. Recent matches include map metadata, observed timestamps, selected notification providers, and ADS-B Exchange links when an ICAO hex is available.

In Kubernetes, worker and API mount the same PVC at `/status` and use `/status/status.json`.

## Notifications

Implemented:

- Email through SMTP
- Phone push notifications through Pushover
- Text messages through Twilio SMS
- Generic JSON webhook

For Gmail SMTP, use a Google app password rather than your normal Google password. The example config uses:

```json
"email": {
  "enabled": false,
  "smtp_host": "smtp.gmail.com",
  "smtp_port": 587,
  "starttls": true,
  "username": "env:SMTP_USERNAME",
  "password": "env:SMTP_PASSWORD",
  "from": "yourname@gmail.com",
  "to": ["yourname@gmail.com"],
  "subject_template": "ADS-B alert: {aircraft_label} matched {rule_name}",
  "body_template": "{message}\n\nAircraft: {aircraft_label}\nRegistration: {registration}\nFlight: {flight}\nType: {aircraft_type}\nDescription: {description}\nOperator: {operator}\nAltitude: {altitude_label}\nDistance: {distance_miles:.1f} mi\nTrack: {track_label}\nSpeed: {ground_speed_label}\nVertical rate: {vertical_rate_label}\nSquawk: {squawk}\nSeen: {seen_label}\nHex: {hex}\nADS-B Exchange: {adsb_exchange_url}\nRule: {rule_name}\nObserved: {observed_at}"
}
```

Set `SMTP_USERNAME` to the Gmail address and `SMTP_PASSWORD` to the Google app password. Then enable email in the UI and use the Email Test button.

Notification formats are provider-specific. Email supports `subject_template` and `body_template`, Pushover supports `title_template` and `message_template`, Twilio supports `body_template`, and webhook supports `message_template`. If a template is omitted, the notifier keeps using the original compact message.

Useful placeholders:

- Aircraft identity: `{aircraft_label}`, `{registration}`, `{flight}`, `{hex}`, `{aircraft_type}`, `{category}`
- Aircraft details: `{description}`, `{operator}`, `{squawk}`, `{emergency}`, `{military}`
- Position and motion: `{distance_miles:.1f}`, `{distance_miles_1}`, `{altitude_ft}`, `{altitude_label}`, `{ground_speed_kt}`, `{ground_speed_label}`, `{track_deg}`, `{track_label}`, `{vertical_rate_fpm}`, `{vertical_rate_label}`, `{lat}`, `{lon}`, `{seen_seconds}`, `{seen_label}`
- Alert metadata: `{message}`, `{rule_name}`, `{event_type}`, `{observed_at}`, `{adsb_exchange_url}`

Pushover is the recommended phone notification provider for home deployments because it avoids carrier SMS registration and compliance overhead. Create a Pushover application, put its API token in `PUSHOVER_APP_TOKEN`, and put your user key in `PUSHOVER_USER_KEY`.

```json
"pushover": {
  "enabled": false,
  "app_token": "env:PUSHOVER_APP_TOKEN",
  "user_key": "env:PUSHOVER_USER_KEY",
  "device": "",
  "priority": 0,
  "sound": "pushover",
  "title_template": "ADS-B: {aircraft_label}",
  "message_template": "{rule_name}: {aircraft_label} ({aircraft_type}) {distance_miles_1} mi away at {altitude_label}"
}
```

Twilio SMS remains available as an optional advanced provider. SMS messages should stay short. For example:

```json
"twilio": {
  "enabled": false,
  "account_sid": "env:TWILIO_ACCOUNT_SID",
  "api_key_sid": "env:TWILIO_API_KEY_SID",
  "api_key_secret": "env:TWILIO_API_KEY_SECRET",
  "from": "env:TWILIO_FROM",
  "to": "env:TWILIO_TO",
  "body_template": "{rule_name}: {aircraft_label} {distance_miles_1} mi away at {altitude_label}"
}
```

Twilio API keys are preferred over the account auth token. The Account SID still identifies the account in the API URL; the API key SID and secret are used for Basic Auth. Existing configs with `auth_token` still work as a fallback.

Twitter/X posting is left as a webhook integration point because the current API access model varies by account and plan. Put a small bridge behind the webhook if you want posts published to X.

## Container

```bash
docker build -f Dockerfile -t pi-lab-registry.local/adsb-notifier-worker:latest .
docker push pi-lab-registry.local/adsb-notifier-worker:latest

docker build -f Dockerfile.api -t pi-lab-registry.local/adsb-notifier-api:latest .
docker push pi-lab-registry.local/adsb-notifier-api:latest

docker build -f Dockerfile.ui -t pi-lab-registry.local/adsb-notifier-ui:latest .
docker push pi-lab-registry.local/adsb-notifier-ui:latest
```

## Kubernetes

The checked-in manifests deploy into the `adsb` namespace and use the local Pi registry image names:

- `pi-lab-registry.local/adsb-notifier-worker:latest`
- `pi-lab-registry.local/adsb-notifier-api:latest`
- `pi-lab-registry.local/adsb-notifier-ui:latest`

Edit `k8s/configmap.yaml` if you want to change the initial seed configuration before the first deploy. Then create/update the runtime secret. For local testing, the root `.env` file can be used directly:

```bash
set -a
source .env
set +a

kubectl -n adsb create secret generic adsb-notifier-secrets \
  --from-literal=SMTP_USERNAME="${SMTP_USERNAME:-}" \
  --from-literal=SMTP_PASSWORD="${SMTP_PASSWORD:-}" \
  --from-literal=TWILIO_ACCOUNT_SID="${TWILIO_ACCOUNT_SID:-}" \
  --from-literal=TWILIO_API_KEY_SID="${TWILIO_API_KEY_SID:-}" \
  --from-literal=TWILIO_API_KEY_SECRET="${TWILIO_API_KEY_SECRET:-}" \
  --from-literal=TWILIO_FROM="${TWILIO_FROM:-}" \
  --from-literal=TWILIO_TO="${TWILIO_TO:-}" \
  --from-literal=PUSHOVER_APP_TOKEN="${PUSHOVER_APP_TOKEN:-}" \
  --from-literal=PUSHOVER_USER_KEY="${PUSHOVER_USER_KEY:-}" \
  --from-literal=ALERT_WEBHOOK_URL="${ALERT_WEBHOOK_URL:-}" \
  --dry-run=client -o yaml | kubectl apply -f -
```

Or create a full secret manifest from explicit values:

```bash
kubectl -n adsb create secret generic adsb-notifier-secrets \
  --from-literal=SMTP_USERNAME='yourname@gmail.com' \
  --from-literal=SMTP_PASSWORD='your-google-app-password' \
  --from-literal=TWILIO_ACCOUNT_SID='ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' \
  --from-literal=TWILIO_API_KEY_SID='SKxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' \
  --from-literal=TWILIO_API_KEY_SECRET='your-twilio-api-key-secret' \
  --from-literal=TWILIO_FROM='+15551234567' \
  --from-literal=TWILIO_TO='+15557654321' \
  --from-literal=PUSHOVER_APP_TOKEN='your-pushover-app-token' \
  --from-literal=PUSHOVER_USER_KEY='your-pushover-user-key' \
  --from-literal=ALERT_WEBHOOK_URL='https://example.test/adsb-webhook' \
  --dry-run=client -o yaml > k8s/secret.yaml
```

```bash
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

The ConfigMap is only seed data. The API pod copies it into the PVC when `/config/config.json` does not exist. After that, the API and UI manage the live config on the PVC, and the worker reads the current config from `http://adsb-notifier-api:8000/config`. The worker writes operational status to the same PVC at `/status/status.json`, and the API exposes it through `GET /status`. The API keeps the newest 20 config backups by default.

### Helm

The Helm chart lives in `charts/adsb-notifier` and defaults to the same Pi lab image registry and ingress hosts used by the raw manifests. The PVC is annotated with `helm.sh/resource-policy: keep` so live configuration is not deleted by `helm uninstall`.

Install or upgrade with:

```bash
make deploy-helm
make rollout
```

When adopting resources that were first created with `kubectl apply`, run the first Helm deployment with:

```bash
make deploy-helm HELM_ADOPT=true HELM_ARGS='--server-side=false'
```

Check rollout and access:

```bash
kubectl -n adsb get pods,svc,ingress,pvc
curl http://adsb-notifier.10.0.0.100.sslip.io/api/status
```

The UI is exposed through ingress at `http://adsb-notifier.10.0.0.100.sslip.io/`. The alternate host `adsb-notifier.local` is also configured, but it requires local DNS or an `/etc/hosts` entry pointing to `10.0.0.100`.

For production, replace `secret.yaml` with your secret-management workflow.
