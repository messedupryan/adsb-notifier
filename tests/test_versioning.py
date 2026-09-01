import re
import tomllib
from pathlib import Path

from adsb_notifier.version import __version__


ROOT = Path(__file__).resolve().parents[1]

VERSION_MANAGED_FILES = [
    "VERSION",
    "pyproject.toml",
    "charts/adsb-notifier/Chart.yaml",
    "charts/adsb-notifier/values.example.yaml",
    "ui/index.html",
    "ui/js/bootstrap.js",
    "ui/js/config-flow.js",
    "ui/js/dashboard.js",
    "ui/js/forms.js",
    "ui/js/map-utils.js",
    "ui/js/modal.js",
    "ui/js/rule-actions.js",
    "ui/js/rule-model.js",
    "ui/js/state.js",
    "ui/js/theme.js",
    "ui/js/ui-utils.js",
    "ui/js/validation.js",
    "adsb_notifier/version.py",
    "docs/DEVELOPMENT.md",
    "docs/VERSIONING.md",
    "README.md",
    "Dockerfile",
    "Dockerfile.api",
    "Dockerfile.ui",
    "Makefile.example",
    "tests/test_versioning.py",
]


def project_version() -> str:
    return (ROOT / "VERSION").read_text(encoding="utf-8").strip()


def chart_field(name: str) -> str:
    chart = (ROOT / "charts" / "adsb-notifier" / "Chart.yaml").read_text(encoding="utf-8")
    match = re.search(rf"^{name}:\s*\"?([^\"\n]+)\"?$", chart, re.MULTILINE)
    assert match is not None
    return match.group(1)


def test_project_version_uses_beta_semver():
    assert re.fullmatch(r"0\.\d+\.\d+(-rc\.\d+)?", project_version())


def test_python_package_version_matches_project_version():
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))

    assert pyproject["project"]["version"] == project_version()
    assert __version__ == project_version()


def test_helm_chart_version_matches_project_version():
    assert chart_field("version") == project_version()
    assert chart_field("appVersion") == project_version()


def test_default_image_tag_matches_project_version():
    values = (ROOT / "charts" / "adsb-notifier" / "values.example.yaml").read_text(encoding="utf-8")

    assert f"  tag: {project_version()}" in values


def test_makefile_bump_version_target_covers_version_managed_files():
    makefile = (ROOT / "Makefile.example").read_text(encoding="utf-8")

    assert "bump-version:" in makefile
    assert "NEW_VERSION" in makefile
    for path in VERSION_MANAGED_FILES:
        assert path in makefile


def test_makefile_release_candidate_target_is_guarded_and_versioned():
    makefile = (ROOT / "Makefile.example").read_text(encoding="utf-8")

    assert "release-rc:" in makefile
    assert "check-clean:" in makefile
    assert "NEXT_RC_VERSION" in makefile
    assert 'python3 -m adsb_notifier.release next-rc "$(PROJECT_VERSION)"' in makefile
    assert "Git worktree must be clean before release work starts." in makefile
    assert 'bump-version NEW_VERSION="$(RC_VERSION)"' in makefile
    assert 'release PROJECT_VERSION="$(RC_VERSION)" IMAGE_TAG="$(RC_VERSION)"' in makefile


def test_makefile_release_notes_target_drafts_github_release_notes():
    makefile = (ROOT / "Makefile.example").read_text(encoding="utf-8")

    assert "release-notes:" in makefile
    assert "VERSION must be a stable minor version like 0.x.0" in makefile
    assert 'python3 -m adsb_notifier.release notes "$(VERSION)" "$(PREVIOUS_VERSION)"' in makefile
    assert '$(RELEASE_NOTES_DIR)/v$(VERSION).md' in makefile


def test_local_deploy_files_are_ignored():
    gitignore = (ROOT / ".gitignore").read_text(encoding="utf-8")

    assert "\nMakefile\n" in gitignore
    assert "charts/*/values.yaml" in gitignore
    assert "!charts/*/values.example.yaml" in gitignore


def test_python_dockerfiles_use_pipenv_with_python_314():
    for name in ["Dockerfile", "Dockerfile.api"]:
        dockerfile = (ROOT / name).read_text(encoding="utf-8")

        assert "FROM python:3.14-slim AS builder" in dockerfile
        assert "FROM python:3.14-slim" in dockerfile
        assert "COPY Pipfile Pipfile.lock pyproject.toml ./" in dockerfile
        assert "RUN pipenv verify && pipenv sync" in dockerfile
        assert "PATH=\"/app/.venv/bin:${PATH}\"" in dockerfile
        assert "pip install" not in dockerfile
