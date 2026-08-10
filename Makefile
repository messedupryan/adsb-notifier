SHELL := /bin/bash

PROJECT_VERSION := $(shell tr -d '[:space:]' < VERSION)
REGISTRY ?= registry.example.test
IMAGE_TAG ?= $(PROJECT_VERSION)
NAMESPACE ?= adsb
RELEASE ?= adsb-notifier
HELM_CHART ?= charts/adsb-notifier
HELM_VALUES ?= charts/adsb-notifier/values.yaml
HELM_ADOPT ?= false
HELM_ARGS ?=

LOCAL_CONFIG ?= config.dev.json
API_HOST ?= 127.0.0.5
API_PORT ?= 8765
UI_PORT ?= 8766
STATUS_FILE ?= status.json
BACKUP_RETENTION ?= 20

WORKER_IMAGE := $(REGISTRY)/adsb-notifier-worker:$(IMAGE_TAG)
API_IMAGE := $(REGISTRY)/adsb-notifier-api:$(IMAGE_TAG)
UI_IMAGE := $(REGISTRY)/adsb-notifier-ui:$(IMAGE_TAG)

VERSION_FILES := VERSION pyproject.toml charts/adsb-notifier/Chart.yaml charts/adsb-notifier/values.yaml ui/index.html ui/app.js adsb_notifier/version.py docs/DEVELOPMENT.md docs/VERSIONING.md README.md Dockerfile Dockerfile.api Dockerfile.ui Makefile tests/test_versioning.py

.PHONY: help version bump-version test local local-api local-ui worker-once build build-worker build-api build-ui push build-push k8s-secret deploy-k8s deploy-helm rollout status

help:
	@printf '%s\n' \
		'ADS-B Notifier targets:' \
		'  make test          Run pytest' \
		'  make local         Run API and UI locally until Ctrl+C' \
		'  make local-api     Run only the local config API' \
		'  make local-ui      Run only the local UI server' \
		'  make worker-once   Run one worker poll locally' \
		'  make build         Build worker, API, and UI container images' \
		'  make push          Push worker, API, and UI container images' \
		'  make build-push    Build and push all images' \
		'  make k8s-secret    Create/update Kubernetes secret from .env' \
		'  make deploy-k8s    Apply raw Kubernetes manifests' \
		'  make deploy-helm   Deploy Helm chart with helm upgrade --install' \
		'  make rollout       Wait for Kubernetes deployments to roll out' \
		'  make status        Show Kubernetes resources' \
		'  make version       Show project/component version and image tags' \
		'  make bump-version NEW_VERSION=0.0.6  Bump project/component version files' \
		'' \
		'Common overrides:' \
		'  REGISTRY=registry.example.test IMAGE_TAG=$(PROJECT_VERSION) NAMESPACE=adsb' \
		'  LOCAL_CONFIG=config.dev.json API_PORT=8765 UI_PORT=8766' \
		'  HELM_CHART=charts/adsb-notifier HELM_VALUES=charts/adsb-notifier/values.yaml' \
		'  HELM_ADOPT=true HELM_ARGS="--set image.tag=$(PROJECT_VERSION)"'

version:
	@printf '%s\n' \
		'Project version: $(PROJECT_VERSION)' \
		'Worker image:    $(WORKER_IMAGE)' \
		'API image:       $(API_IMAGE)' \
		'UI image:        $(UI_IMAGE)'

bump-version:
	@test -n "$(NEW_VERSION)" || { echo "Usage: make bump-version NEW_VERSION=0.0.6"; exit 1; }
	@echo "$(NEW_VERSION)" | grep -Eq '^0\.0\.[0-9]+$$' || { echo "NEW_VERSION must match beta semver pattern 0.0.x"; exit 1; }
	@old_version="$(PROJECT_VERSION)"; \
	if [ "$$old_version" = "$(NEW_VERSION)" ]; then \
		echo "Version is already $(NEW_VERSION)"; \
		exit 0; \
	fi; \
	OLD_VERSION="$$old_version" NEW_VERSION="$(NEW_VERSION)" \
		perl -0pi -e 's/\Q$$ENV{OLD_VERSION}\E/$$ENV{NEW_VERSION}/g' $(VERSION_FILES); \
	echo "Bumped version $$old_version -> $(NEW_VERSION)"

test:
	pipenv run pytest -q

local:
	@if [ ! -f "$(LOCAL_CONFIG)" ]; then echo "Missing $(LOCAL_CONFIG). Set LOCAL_CONFIG=..."; exit 1; fi
	@set -e; \
	pipenv run adsb-notifier-api --config "$(LOCAL_CONFIG)" --host "$(API_HOST)" --port "$(API_PORT)" --status-file "$(STATUS_FILE)" --backup-retention "$(BACKUP_RETENTION)" & api_pid=$$!; \
	( cd ui && UI_HOST=127.0.0.5 UI_PORT="$(UI_PORT)" pipenv run python dev_server.py ) & ui_pid=$$!; \
	trap 'kill $$api_pid $$ui_pid 2>/dev/null || true' INT TERM EXIT; \
	echo "API: http://$(API_HOST):$(API_PORT)"; \
	echo "UI:  http://127.0.0.5:$(UI_PORT)/?api=http://$(API_HOST):$(API_PORT)"; \
	wait

local-api:
	@if [ ! -f "$(LOCAL_CONFIG)" ]; then echo "Missing $(LOCAL_CONFIG). Set LOCAL_CONFIG=..."; exit 1; fi
	pipenv run adsb-notifier-api --config "$(LOCAL_CONFIG)" --host "$(API_HOST)" --port "$(API_PORT)" --status-file "$(STATUS_FILE)" --backup-retention "$(BACKUP_RETENTION)"

local-ui:
	cd ui && UI_HOST=127.0.0.5 UI_PORT="$(UI_PORT)" pipenv run python dev_server.py

worker-once:
	@if [ ! -f "$(LOCAL_CONFIG)" ]; then echo "Missing $(LOCAL_CONFIG). Set LOCAL_CONFIG=..."; exit 1; fi
	pipenv run adsb-notifier --config "$(LOCAL_CONFIG)" --status-file "$(STATUS_FILE)" --once

build: build-worker build-api build-ui

build-worker:
	docker build --build-arg APP_VERSION="$(PROJECT_VERSION)" -f Dockerfile -t "$(WORKER_IMAGE)" .

build-api:
	docker build --build-arg APP_VERSION="$(PROJECT_VERSION)" -f Dockerfile.api -t "$(API_IMAGE)" .

build-ui:
	docker build --build-arg APP_VERSION="$(PROJECT_VERSION)" -f Dockerfile.ui -t "$(UI_IMAGE)" .

push:
	docker push "$(WORKER_IMAGE)"
	docker push "$(API_IMAGE)"
	docker push "$(UI_IMAGE)"

build-push: build push

k8s-secret:
	@set -a; [ ! -f .env ] || source .env; set +a; \
	kubectl -n "$(NAMESPACE)" create secret generic adsb-notifier-secrets \
		--from-literal=SMTP_USERNAME="$${SMTP_USERNAME:-}" \
		--from-literal=SMTP_PASSWORD="$${SMTP_PASSWORD:-}" \
		--from-literal=TWILIO_ACCOUNT_SID="$${TWILIO_ACCOUNT_SID:-}" \
		--from-literal=TWILIO_API_KEY_SID="$${TWILIO_API_KEY_SID:-}" \
		--from-literal=TWILIO_API_KEY_SECRET="$${TWILIO_API_KEY_SECRET:-}" \
		--from-literal=TWILIO_FROM="$${TWILIO_FROM:-}" \
		--from-literal=TWILIO_TO="$${TWILIO_TO:-}" \
		--from-literal=PUSHOVER_APP_TOKEN="$${PUSHOVER_APP_TOKEN:-}" \
		--from-literal=PUSHOVER_USER_KEY="$${PUSHOVER_USER_KEY:-}" \
		--dry-run=client -o yaml | kubectl apply -f -

deploy-k8s:
	kubectl apply -f k8s/pvc.yaml
	kubectl apply -f k8s/configmap.yaml
	kubectl apply -f k8s/service.yaml
	kubectl apply -f k8s/deployment.yaml
	kubectl apply -f k8s/ingress.yaml

deploy-helm:
	@test -f "$(HELM_CHART)/Chart.yaml" || { echo "No Helm chart found at $(HELM_CHART). Set HELM_CHART=... or create the chart first."; exit 1; }
	@test ! -f "$(HELM_VALUES)" || values_arg="--values $(HELM_VALUES)"; \
	adopt_arg=""; \
	if [ "$(HELM_ADOPT)" = "true" ]; then adopt_arg="--take-ownership"; fi; \
	helm upgrade --install "$(RELEASE)" "$(HELM_CHART)" --namespace "$(NAMESPACE)" --create-namespace $$values_arg --set image.tag="$(IMAGE_TAG)" $$adopt_arg $(HELM_ARGS)

rollout:
	kubectl -n "$(NAMESPACE)" rollout status deployment/adsb-notifier-api --timeout=120s
	kubectl -n "$(NAMESPACE)" rollout status deployment/adsb-notifier-ui --timeout=120s
	kubectl -n "$(NAMESPACE)" rollout status deployment/adsb-notifier-worker --timeout=120s

status:
	kubectl -n "$(NAMESPACE)" get pods,svc,ingress,pvc
