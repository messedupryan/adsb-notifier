from pathlib import Path

import pytest

from adsb_notifier.release import (
    generate_release_notes,
    main,
    next_release_candidate_version,
    release_notes_path,
    validate_stable_minor_version,
)


@pytest.mark.parametrize(
    ("current", "expected"),
    [
        ("0.1.14", "0.2.0-rc.1"),
        ("0.2.0-rc.1", "0.2.0-rc.2"),
        ("0.2.0-rc.2", "0.2.0-rc.3"),
        ("0.2.0", "0.3.0-rc.1"),
    ],
)
def test_next_release_candidate_version(current, expected):
    assert next_release_candidate_version(current) == expected


@pytest.mark.parametrize("current", ["1.0.0", "0.2", "0.2.0-beta.1", "banana"])
def test_next_release_candidate_version_rejects_unsupported_versions(current):
    with pytest.raises(ValueError, match="version must match"):
        next_release_candidate_version(current)


def test_release_helper_cli_outputs_next_rc(capsys):
    assert main(["next-rc", "0.2.0-rc.1"]) == 0

    assert capsys.readouterr().out.strip() == "0.2.0-rc.2"


def test_release_notes_require_stable_minor_versions():
    assert validate_stable_minor_version("0.3.0") == "0.3.0"

    for version in ["0.3.0-rc.1", "0.2.1", "1.0.0"]:
        with pytest.raises(ValueError, match="stable minor"):
            validate_stable_minor_version(version)


def test_release_notes_path_uses_docs_releases_directory():
    assert release_notes_path("0.3.0") == Path("docs/releases/v0.3.0.md")


def test_generate_release_notes_creates_github_release_draft():
    notes = generate_release_notes(
        "0.3.0",
        "0.2.0",
        roadmap="ADSB-Notifier Roadmap v0.3.0",
        commits=["abc1234 feat(ui): add release notes"],
        released_on="2026-08-29",
    )

    assert notes.startswith("# ADS-B Notifier v0.3.0")
    assert "Released: 2026-08-29" in notes
    assert "Draft source: changes since `v0.2.0`." in notes
    assert "- Roadmap: ADSB-Notifier Roadmap v0.3.0" in notes
    assert "## Highlights" in notes
    assert "## Commit History" in notes
    assert "- abc1234 feat(ui): add release notes" in notes
    assert "No custom binaries or release artifacts" in notes


def test_release_helper_cli_outputs_release_notes(capsys):
    assert (
        main(
            [
                "notes",
                "0.3.0",
                "0.2.0",
                "--roadmap",
                "ADSB-Notifier Roadmap v0.3.0",
                "--date",
                "2026-08-29",
            ]
        )
        == 0
    )

    output = capsys.readouterr().out
    assert "# ADS-B Notifier v0.3.0" in output
    assert "Released: 2026-08-29" in output


def test_release_helper_cli_rejects_patch_release_notes(capsys):
    assert main(["notes", "0.2.1", "0.2.0"]) == 2

    assert "stable minor" in capsys.readouterr().err
