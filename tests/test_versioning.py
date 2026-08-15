import re
import tomllib
from pathlib import Path

from adsb_notifier.version import __version__


ROOT = Path(__file__).resolve().parents[1]

VERSION_MANAGED_FILES = [
    "VERSION",
    "pyproject.toml",
    "charts/adsb-notifier/Chart.yaml",
    "charts/adsb-notifier/values.yaml",
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
    "Makefile",
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
    assert re.fullmatch(r"0\.0\.\d+", project_version())


def test_python_package_version_matches_project_version():
    pyproject = tomllib.loads((ROOT / "pyproject.toml").read_text(encoding="utf-8"))

    assert pyproject["project"]["version"] == project_version()
    assert __version__ == project_version()


def test_helm_chart_version_matches_project_version():
    assert chart_field("version") == project_version()
    assert chart_field("appVersion") == project_version()


def test_default_image_tag_matches_project_version():
    values = (ROOT / "charts" / "adsb-notifier" / "values.yaml").read_text(encoding="utf-8")

    assert f"  tag: {project_version()}" in values


def test_makefile_bump_version_target_covers_version_managed_files():
    makefile = (ROOT / "Makefile").read_text(encoding="utf-8")

    assert "bump-version:" in makefile
    assert "NEW_VERSION" in makefile
    for path in VERSION_MANAGED_FILES:
        assert path in makefile
