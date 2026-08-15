# Versioning and Promotion

ADS-B Notifier is in beta and uses SemVer-style `0.0.x` versions until the project is stable enough for `0.1.0`.

## Source of Truth

The root `VERSION` file is the project version source of truth.

The current beta version is:

```text
0.0.7
```

For now, the worker, API, UI, Python package, Helm chart, and container images all share the project version. Split component versions only when the components need independent release cadence.

Version-aligned files:

- `VERSION`
- `pyproject.toml`
- `adsb_notifier/version.py`
- `ui/js/state.js`
- `ui/index.html`
- `charts/adsb-notifier/Chart.yaml`
- `charts/adsb-notifier/values.yaml`

Run `make version` to display the project version and image tags that will be built.

## Beta Version Rules

- Use `0.0.x` while the project is still changing quickly.
- Increment the patch version for each stable batch of work that should be deployable or eligible for promotion.
- Keep all components on the same version during beta unless there is a strong reason to split them.
- Avoid deploying `latest` for normal testing. Use the explicit version tag, such as `0.0.7`.

## Branch Flow

- `develop` is the active integration branch.
- `main` is the stable branch.
- Feature and cleanup work lands on `develop`.
- When a version on `develop` is tested and considered stable, merge that version into `main`.
- Tag promoted main commits as `v0.0.x`.

Suggested promotion flow:

```bash
git switch develop
pipenv run pytest -q
helm lint charts/adsb-notifier
make version

git switch main
git merge --no-ff develop
git tag v0.0.x
git push origin main v0.0.x
```

## Deployment Tags

By default, the Makefile uses the version from `VERSION` as the image tag:

```bash
make build REGISTRY=registry.example.test
make push REGISTRY=registry.example.test
make deploy-helm REGISTRY=registry.example.test
```

This builds and deploys:

```text
registry.example.test/adsb-notifier-worker:0.0.7
registry.example.test/adsb-notifier-api:0.0.7
registry.example.test/adsb-notifier-ui:0.0.7
```

Use `IMAGE_TAG=...` only when intentionally testing a nonstandard tag.

## Version Bump Checklist

When preparing the next beta version:

1. Update `VERSION`.
2. Update the version-aligned files listed above.
3. Run `make version`.
4. Run `pipenv run pytest -q`.
5. Run `helm lint charts/adsb-notifier`.
6. Build, push, and deploy images using the explicit version tag.
