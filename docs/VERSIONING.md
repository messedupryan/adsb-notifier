# Versioning and Promotion

ADS-B Notifier is in beta and uses SemVer-style `0.x.y` versions. Release-candidate builds use an explicit prerelease suffix such as `0.x.0-rc.n`; stable cuts drop the prerelease suffix, such as `0.x.0`.

## Source of Truth

The root `VERSION` file is the project version source of truth.

The current beta version is:

```text
0.2.4
```

For now, the worker, API, UI, Python package, Helm chart, and container images all share the project version. Split component versions only when the components need independent release cadence.

Version-aligned files:

- `VERSION`
- `pyproject.toml`
- `adsb_notifier/version.py`
- `ui/js/state.js`
- `ui/index.html`
- `charts/adsb-notifier/Chart.yaml`
- `charts/adsb-notifier/values.example.yaml`
- `Makefile.example`

Run `make version` to display the project version and image tags that will be built.

## Beta Version Rules

- Use `0.x.y` while the project is still changing quickly.
- Increment the patch version for each stable batch of work that should be deployable or eligible for promotion.
- While building toward the next minor release, use numeric patch versions on `develop` as deployable checkpoints. For example, after stable `0.2.0`, use `0.2.1`, `0.2.2`, and later `0.2.x` while building toward `0.3.0`.
- Use prerelease suffixes only for release-candidate builds that are feature-complete and ready for soak testing, such as `0.x.0-rc.n`.
- Avoid alpha/beta prerelease versions unless the project convention intentionally changes.
- Keep all components on the same version during beta unless there is a strong reason to split them.
- Avoid deploying `latest` for normal testing. Use the explicit project version tag.

## Branch Flow

- `develop` is the active integration branch.
- `main` is the stable branch.
- Feature and cleanup work lands on `develop`.
- When a version on `develop` is tested and considered stable, merge that version into `main`.
- Tag promoted main commits as `v0.x.y` or `v0.x.y-rc.n`.

Suggested promotion flow:

```bash
git switch develop
pipenv run pytest -q
helm lint charts/adsb-notifier
make version

git switch main
git merge --no-ff develop
git tag v0.3.0
git push origin main v0.3.0
```

Release-note drafts live under `docs/releases/` and are written for GitHub Releases. Stable minor releases should have a concise public summary before or during promotion; patch checkpoints and release candidates do not need formal release notes unless there is a specific operational reason.

Draft release notes from the roadmap and commit history:

```bash
make release-notes VERSION=0.3.0 PREVIOUS_VERSION=0.2.0 ROADMAP="ADSB-Notifier Roadmap v0.3.0"
```

The generated draft is a starting point for the GitHub Release body. Keep the final text focused on functional changes, validation, and notable operational notes; do not add binary or custom artifact expectations.

## Deployment Tags

By default, the Makefile uses the version from `VERSION` as the image tag:

```bash
make build REGISTRY=registry.example.test
make push REGISTRY=registry.example.test
make deploy-helm REGISTRY=registry.example.test HELM_VALUES=charts/adsb-notifier/values.example.yaml
```

This builds and deploys:

```text
registry.example.test/adsb-notifier-worker:<project-version>
registry.example.test/adsb-notifier-api:<project-version>
registry.example.test/adsb-notifier-ui:<project-version>
```

Use `IMAGE_TAG=...` only when intentionally testing a nonstandard tag.

## Release Candidate Builds

After the committed next-minor scope is complete on `develop`, use the one-command RC workflow from a clean worktree:

```bash
git switch develop
pipenv run pytest -q
helm lint charts/adsb-notifier
make release-rc
```

The `release-rc` target fails early if the git worktree is dirty. When clean, it derives the next RC from the current `VERSION`, either from the latest numeric checkpoint to the next minor `rc.1`, or from one RC to the next. It then bumps all version-managed files to `RC_VERSION`, builds and pushes the worker/API/UI images with that tag, deploys the Helm chart with the same tag, and waits for rollout. Pass `RC_VERSION=...` only when you need to override the inferred next candidate.

After the deployed RC looks good, commit the RC version bump and tag the committed candidate:

```bash
git add VERSION pyproject.toml adsb_notifier/version.py charts/adsb-notifier/Chart.yaml charts/adsb-notifier/values.example.yaml ui docs README.md Makefile.example tests/test_versioning.py
git commit -m "chore(release): prepare <rc-version>"
git tag v<rc-version>
```

## Version Bump Checklist

For normal feature work, bump the version after the current feature slice has been locally validated, deployed/validated in the cluster when needed, and committed at the current version. The bump prepares the next feature checkpoint.

When preparing the next beta version:

1. Update `VERSION`.
2. Update the version-aligned files listed above.
3. Run `make version`.
4. Run `pipenv run pytest -q`.
5. Run `helm lint charts/adsb-notifier`.
6. Build, push, and deploy images using the explicit version tag.
