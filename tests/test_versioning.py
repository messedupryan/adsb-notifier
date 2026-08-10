import re
import tomllib
from pathlib import Path

from adsb_notifier.version import __version__


ROOT = Path(__file__).resolve().parents[1]


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
