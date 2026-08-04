# ADS-B Notifier

Containerized ADS-B notification system with three Kubernetes-friendly components:

- Worker service that polls ADS-B aircraft JSON and sends notifications
- Configuration API that validates and persists runtime config
- Web UI for editing the shared configuration

## Supported Events

- Specific tail number, callsign, or ICAO hex near home
- Optional minimum and maximum altitude filters
- Military aircraft near home, when the ADS-B source marks `military: true`
- Specific aircraft type or ADS-B category
- Circling pattern detection based on accumulated heading changes inside a radius

The service works with common `dump1090`, `readsb`, and `tar1090` JSON feeds that expose `aircraft.json`.

## Local Run

```bash
cp config.example.json config.json
pipenv install --dev
pipenv run adsb-notifier --config config.json
```

Run the config API locally:

```bash
pipenv run adsb-notifier-api --config config.json --host 127.0.0.1 --port 8000 --backup-retention 20
```

The API writes config snapshots to a `backups/` directory beside the active config before overwrites. `--backup-retention` controls how many snapshots to keep; use `0` to disable backups.

Run the no-cache UI dev server locally:

```bash
cd ui
python3 dev_server.py
```

Open the UI against a local API:

```text
http://127.0.0.1:8766/?api=http://127.0.0.1:8000
```

Run a single poll:

```bash
pipenv run adsb-notifier --config config.json --once
```

Run tests:

```bash
pipenv run pytest -q
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

## Configuration API

Implemented:

- `GET /healthz`
- `GET /config`
- `PUT /config`
- `GET /rules`
- `POST /rules`
- `PUT /rules/{id}`
- `DELETE /rules/{id}`

The UI uses the rule-specific endpoints for rule create, update, duplicate, and delete workflows. The full-config endpoint remains available for settings, notification blocks, raw JSON edits, and worker config loading.

## Notifications

Implemented:

- Email through SMTP
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
  "to": ["yourname@gmail.com"]
}
```

Set `SMTP_USERNAME` to the Gmail address and `SMTP_PASSWORD` to the Google app password. Then enable email in the UI and use the Email Test button.

Twitter/X posting is left as a webhook integration point because the current API access model varies by account and plan. Put a small bridge behind the webhook if you want posts published to X.

## Container

```bash
docker build -f Dockerfile -t ghcr.io/messedUpRyan/adsb-notifier-worker:latest .
docker build -f Dockerfile.api -t ghcr.io/messedUpRyan/adsb-notifier-api:latest .
docker build -f Dockerfile.ui -t ghcr.io/messedUpRyan/adsb-notifier-ui:latest .
```

## Kubernetes

Edit `k8s/configmap.yaml`, create a real secret from `k8s/secret.example.yaml`, update image tags in `k8s/deployment.yaml`, then apply:

```bash
kubectl create secret generic adsb-notifier-secrets \
  --from-literal=SMTP_USERNAME='yourname@gmail.com' \
  --from-literal=SMTP_PASSWORD='your-google-app-password' \
  --dry-run=client -o yaml > k8s/secret.yaml
```

```bash
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/secret.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/deployment.yaml
```

The ConfigMap is only seed data. The API pod copies it into the PVC when `/config/config.json` does not exist. After that, the API and UI manage the live config on the PVC, and the worker reads the current config from `http://adsb-notifier-api:8000/config`. The API keeps the newest 20 config backups by default.

For local access to the UI:

```bash
kubectl port-forward svc/adsb-notifier-ui 8080:80
```

For production, replace `secret.yaml` with your secret-management workflow.
