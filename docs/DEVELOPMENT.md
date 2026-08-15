# Development Guide

This guide covers local development, testing, container builds, and Kubernetes deployment for ADS-B Notifier.

The public README describes what the project is. This document describes how to work on it.

## Requirements

- Python with Pipenv
- Docker or another OCI-compatible image builder
- kubectl, for Kubernetes work
- Helm, for chart deployments

Install Python dependencies:

```bash
pipenv install --dev
cp config.example.json config.dev.json
```

Use `pipenv run ...` or the Makefile targets so commands run inside the project environment.

## Makefile Targets

Common workflows are wrapped in the root `Makefile`:

```bash
make help
make test
make local
make local-api
make local-ui
make worker-once
make build
make push
make build-push
make k8s-secret
make deploy-helm
make rollout
make status
```

Useful overrides:

```bash
LOCAL_CONFIG=config.dev.json
API_HOST=127.0.0.1
API_PORT=8765
UI_PORT=8766
REGISTRY=registry.example.test
IMAGE_TAG=0.0.8
NAMESPACE=adsb
RELEASE=adsb-notifier
HELM_VALUES=charts/adsb-notifier/values.yaml
```

## Running Locally

Run the API and UI together:

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

Direct commands:

```bash
pipenv run adsb-notifier-api --config config.dev.json --host 127.0.0.1 --port 8765 --status-file status.json --backup-retention 20
cd ui && UI_HOST=127.0.0.1 UI_PORT=8766 pipenv run python dev_server.py
```

Run one worker poll:

```bash
make worker-once LOCAL_CONFIG=config.dev.json
```

Run one worker poll against a local or port-forwarded ADS-B feed:

```bash
pipenv run adsb-notifier --config config.dev.json --adsb-url http://127.0.0.1:8080/tar1090/data/aircraft.json --once
```

## Testing

Run the full test suite:

```bash
make test
```

Equivalent direct command:

```bash
pipenv run pytest -q
```

Before opening a pull request or merging milestone work, run:

```bash
pipenv run pytest -q
helm lint charts/adsb-notifier
```

## Versioning

Run `make version` to see the beta project version and image tags for the worker, API, and UI.

Versioning and promotion rules live in [Versioning and Promotion](VERSIONING.md).

## UI Development Notes

The UI is static HTML, CSS, and JavaScript served by `ui/dev_server.py` locally and by nginx in the UI container.

When changing UI assets or behavior:

- Keep the UI version in `ui/js/state.js` aligned with `VERSION`.
- Update `ui/index.html` asset query strings and footer text to the same version.
- Keep the footer version visible.
- Verify the dashboard still renders recent matches and the map.

The UI uses Leaflet from a CDN for dashboard maps.

## Configuration Development

Keep these files aligned when adding configuration fields:

- `config.example.json`
- `charts/adsb-notifier/values.yaml` under `seedConfig`
- `README.md`
- this development guide, when commands or deployment behavior change

The API creates config backups before overwrites. Backup retention defaults to `20` and can be changed with:

```bash
pipenv run adsb-notifier-api --config config.dev.json --backup-retention 20
```

Use `0` to disable backups.

The API redacts notification secret fields when serving configuration to the UI. In Kubernetes, the worker reads the live config file from shared storage so notification secrets remain available to the worker without exposing them through the browser-facing config response.

## Container Builds

The worker and API images use `python:3.14-slim` and install the application from `Pipfile.lock` with Pipenv during a builder stage. The runtime images copy the project virtualenv into `/app/.venv` and run the console scripts from that environment. The UI image is nginx-only and does not install Python dependencies.

Build all images:

```bash
make build REGISTRY=registry.example.test
```

Push all images:

```bash
make push REGISTRY=registry.example.test
```

Or build and push:

```bash
make build-push REGISTRY=registry.example.test
```

Individual images:

```bash
make build-worker REGISTRY=registry.example.test
make build-api REGISTRY=registry.example.test
make build-ui REGISTRY=registry.example.test
```

## Kubernetes Secrets

Runtime secrets are provided through a Kubernetes Secret. For local testing, you can populate a `.env` file and let the Makefile create or update the Secret:

```bash
make k8s-secret NAMESPACE=adsb
```

Supported environment variables:

```text
SMTP_USERNAME
SMTP_PASSWORD
TWILIO_ACCOUNT_SID
TWILIO_API_KEY_SID
TWILIO_API_KEY_SECRET
TWILIO_FROM
TWILIO_TO
PUSHOVER_APP_TOKEN
PUSHOVER_USER_KEY
```

## Helm Deployment

The Helm chart lives in `charts/adsb-notifier`.

Install or upgrade:

```bash
make deploy-helm \
  REGISTRY=registry.example.test \
  NAMESPACE=adsb \
  RELEASE=adsb-notifier \
  HELM_VALUES=charts/adsb-notifier/values.yaml
```

Wait for rollout:

```bash
make rollout NAMESPACE=adsb
```

Check resources:

```bash
make status NAMESPACE=adsb
```

If adopting resources that were first created outside Helm, use:

```bash
make deploy-helm HELM_ADOPT=true HELM_ARGS='--server-side=false'
```

## Raw Kubernetes Manifests

Raw manifests are available in `k8s/` for reference and early bootstrap work:

```bash
kubectl apply -f k8s/pvc.yaml
kubectl apply -f k8s/configmap.yaml
kubectl apply -f k8s/service.yaml
kubectl apply -f k8s/deployment.yaml
kubectl apply -f k8s/ingress.yaml
```

Prefer the Helm chart for normal deployment work.

## Branching Workflow

Use `main` as the stable branch and `develop` for ongoing work.

Suggested flow:

```bash
git switch develop
git pull
git switch -c feature/my-change
```

After a milestone is stable, merge it back to `main`.
