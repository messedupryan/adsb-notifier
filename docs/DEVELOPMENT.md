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
cp Makefile.example Makefile
cp charts/adsb-notifier/values.example.yaml charts/adsb-notifier/values.yaml
```

Use `pipenv run ...` or the Makefile targets so commands run inside the project environment. The repo tracks `Makefile.example`; copy it to ignored local `Makefile` when setting up a development checkout.

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
make release
make release-rc
make k8s-secret
make deploy-helm
make restart
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
IMAGE_TAG=0.2.9
NAMESPACE=adsb
RELEASE=adsb-notifier
HELM_VALUES=charts/adsb-notifier/values.yaml
RC_VERSION=<override>
```

The public example defaults live in `Makefile.example` and `charts/adsb-notifier/values.example.yaml`. Local deploy-ready files live at `Makefile` and `charts/adsb-notifier/values.yaml`; both local files are ignored by Git so registry names, ingress hosts, namespaces, and other environment-specific values do not leak into commits.

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

## Current-Version Feature Workflow

During normal feature work, keep iteration on the current project version until the slice is validated:

1. Make the code changes on the current version.
2. Run focused tests while iterating.
3. Start the local API/UI for manual validation when it is useful and the local data/config can exercise the change.
4. Run the full test suite before treating the slice as ready.
5. If local validation is insufficient, build/push/deploy the current version to the cluster and validate there.
6. Validate the cluster deployment.
7. Commit the feature at the current version.
8. After the commit, bump the version to prepare the next feature checkpoint.

For quick cluster validation without changing Helm values, rebuild and push the same tag, then restart pods so Kubernetes pulls the current registry images:

```bash
make build-push
make restart
```

For a checkpoint deployment, use:

```bash
make release
```

Local testing is a time-saving measure, not a gate. Because this is a personal app and brief cluster disruption is acceptable, use `make release` whenever the cluster is the most realistic or fastest way to validate a feature. The version bump is the handoff to the next feature, not the first step of the current one.

## Release Candidate Workflow

When the committed next-minor scope is feature-complete and the current checkpoint is committed, prepare and deploy the next release candidate with one command:

```bash
make release-rc
```

`release-rc` requires a clean git worktree before it starts. It derives the next RC version from `VERSION`, either from the latest numeric checkpoint to the next minor `rc.1`, or from one RC to the next. It then bumps all version-managed files to `RC_VERSION`, builds and pushes worker/API/UI images with that tag, deploys the Helm chart with the same image tag, and waits for rollout. Override `RC_VERSION=...` only when preparing a nonstandard candidate. After validating the deployed RC, commit the RC version bump and tag the committed RC when ready.

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
- `charts/adsb-notifier/values.example.yaml` under `seedConfig`
- local `charts/adsb-notifier/values.yaml`, if you keep one for deployment
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

Build, push, deploy the Helm chart, and wait for rollout:

```bash
make release REGISTRY=registry.example.test NAMESPACE=adsb RELEASE=adsb-notifier
```

Prepare and deploy a release candidate from a clean worktree:

```bash
make release-rc REGISTRY=registry.example.test NAMESPACE=adsb RELEASE=adsb-notifier
```

Draft GitHub release notes for a stable minor release:

```bash
make release-notes VERSION=0.3.0 PREVIOUS_VERSION=0.2.0 ROADMAP="ADSB-Notifier Roadmap v0.3.0"
```

This writes `docs/releases/v0.3.0.md` with a GitHub Release-oriented outline and commit history since `v0.2.0`. Patch checkpoints and release candidates usually do not need formal release notes.

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

Map-backed email snapshots use two local caches in the worker container:

```text
ADSB_MAP_TILE_CACHE_DIR=/tmp/adsb-notifier-map-tiles
ADSB_MAP_SNAPSHOT_CACHE_DIR=/tmp/adsb-notifier-map-snapshots
ADSB_MAP_SNAPSHOT_CACHE_SECONDS=86400
```

Raw map tiles are cached by tile coordinate. Rendered base maps are cached by tile source, home location, rule radius, and zoom. The theme tint, radius overlay, home marker, and aircraft-specific overlay are drawn on top for each alert so one cached radius can serve any email theme.

## Helm Deployment

The Helm chart lives in `charts/adsb-notifier`.

Install or upgrade:

```bash
make deploy-helm \
  REGISTRY=registry.example.test \
  NAMESPACE=adsb \
  RELEASE=adsb-notifier \
  HELM_VALUES=charts/adsb-notifier/values.example.yaml
```

Wait for rollout:

```bash
make rollout NAMESPACE=adsb
```

After rebuilding and pushing the same image tag during local validation, restart the deployments so Kubernetes creates new pods and pulls the current registry images:

```bash
make restart NAMESPACE=adsb RELEASE=adsb-notifier
```

Check resources:

```bash
make status NAMESPACE=adsb
```

If adopting resources that were first created outside Helm, use:

```bash
make deploy-helm HELM_ADOPT=true HELM_ARGS='--server-side=false'
```

## Deployment Rollback

Inspect the current release and revision history:

```bash
helm -n adsb status adsb-notifier
helm -n adsb history adsb-notifier
```

Rollback to a previous Helm revision when the previous release metadata and values are known-good:

```bash
helm -n adsb rollback adsb-notifier <REVISION>
kubectl -n adsb rollout status deployment/adsb-notifier-api --timeout=120s
kubectl -n adsb rollout status deployment/adsb-notifier-ui --timeout=120s
kubectl -n adsb rollout status deployment/adsb-notifier-worker --timeout=120s
```

Rollback to a previous image tag while keeping the current Helm values:

```bash
helm -n adsb upgrade adsb-notifier charts/adsb-notifier \
  --reuse-values \
  --set image.tag=<PREVIOUS_VERSION>
make rollout NAMESPACE=adsb
```

After either rollback path, verify the running images, UI version, and API health:

```bash
kubectl -n adsb get deploy -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.template.spec.containers[0].image}{"\n"}{end}'
curl -fsS http://adsb-notifier.example.test/ | grep 'UI '
curl -fsS http://adsb-notifier.example.test/api/healthz
```

## Config Export and Restore

The API writes live config to the shared Kubernetes PVC at `/config/config.json` and stores API-created backups under `/config/backups`.

Export the current live config:

```bash
make config-export NAMESPACE=adsb RELEASE=adsb-notifier
```

By default, this writes to `exports/config/`, which is ignored by Git because live config can contain local environment details.

List config backups currently stored on the PVC:

```bash
make config-backups NAMESPACE=adsb RELEASE=adsb-notifier
```

Export all PVC backups:

```bash
make config-export-backups NAMESPACE=adsb RELEASE=adsb-notifier
```

Restore a local config file into the live PVC:

```bash
make config-restore NAMESPACE=adsb RELEASE=adsb-notifier RESTORE_FILE=exports/config/adsb-notifier.config.20260818T120000Z.json
```

`config-restore` validates that the restore file is JSON and saves the current live config to `/config/backups/config.json.pre-restore.<timestamp>.json` before overwriting `/config/config.json`.

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
