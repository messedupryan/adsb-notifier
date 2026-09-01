"""Release helpers for Makefile workflows."""

from __future__ import annotations

import argparse
import subprocess
from datetime import UTC, datetime
from pathlib import Path
import re
import sys


VERSION_RE = re.compile(r"^0\.(?P<minor>\d+)\.(?P<patch>\d+)(?:-rc\.(?P<rc>\d+))?$")
STABLE_MINOR_RE = re.compile(r"^0\.\d+\.0$")


def next_release_candidate_version(version: str) -> str:
    """Return the next release-candidate version for the current beta version."""

    match = VERSION_RE.fullmatch(version.strip())
    if match is None:
        raise ValueError("version must match 0.x.y or 0.x.y-rc.n")

    minor = int(match.group("minor"))
    patch = int(match.group("patch"))
    rc = match.group("rc")
    if rc is not None:
        return f"0.{minor}.{patch}-rc.{int(rc) + 1}"
    return f"0.{minor + 1}.0-rc.1"


def validate_stable_minor_version(version: str) -> str:
    version = version.strip()
    if STABLE_MINOR_RE.fullmatch(version) is None:
        raise ValueError("release notes are only prepared for stable minor versions like 0.x.0")
    return version


def release_notes_path(version: str, directory: str | Path = "docs/releases") -> Path:
    return Path(directory) / f"v{validate_stable_minor_version(version)}.md"


def commit_history(previous_version: str, ref: str = "HEAD") -> list[str]:
    range_spec = f"v{previous_version}..{ref}"
    result = subprocess.run(
        ["git", "log", "--oneline", "--no-merges", range_spec],
        check=True,
        capture_output=True,
        text=True,
    )
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def generate_release_notes(
    version: str,
    previous_version: str,
    *,
    roadmap: str | None = None,
    commits: list[str] | None = None,
    released_on: str | None = None,
) -> str:
    version = validate_stable_minor_version(version)
    previous_version = previous_version.removeprefix("v").strip()
    if not previous_version:
        raise ValueError("previous version is required")

    released_on = released_on or datetime.now(tz=UTC).date().isoformat()
    commit_lines = commits if commits is not None else commit_history(previous_version)
    roadmap_line = f"- Roadmap: {roadmap}" if roadmap else "- Roadmap: TODO: link the release roadmap or planning note."
    history = "\n".join(f"- {line}" for line in commit_lines) or "- TODO: add commit summary."

    return "\n".join(
        [
            f"# ADS-B Notifier v{version}",
            "",
            f"Released: {released_on}",
            "",
            f"Draft source: changes since `v{previous_version}`.",
            roadmap_line,
            "",
            "## Highlights",
            "",
            "- TODO: summarize the most important user-facing changes.",
            "- TODO: summarize operational or deployment improvements.",
            "- TODO: summarize notable alerting, dashboard, source, or notification changes.",
            "",
            "## Notes",
            "",
            "- No custom binaries or release artifacts are expected beyond the normal GitHub source archives.",
            "- Patch/checkpoint versions and release candidates are summarized here only when they contribute to the stable minor release.",
            "",
            "## Validation",
            "",
            "- TODO: note RC soak result.",
            "- TODO: note full test suite result.",
            "- TODO: note Helm lint and deployment validation.",
            "",
            "## Commit History",
            "",
            history,
            "",
        ]
    )


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description="ADS-B Notifier release helpers.")
    subparsers = parser.add_subparsers(dest="command", required=True)

    next_rc = subparsers.add_parser("next-rc", help="print the next release-candidate version")
    next_rc.add_argument("version")

    notes = subparsers.add_parser("notes", help="draft GitHub release notes for a stable minor release")
    notes.add_argument("version")
    notes.add_argument("previous_version")
    notes.add_argument("--roadmap")
    notes.add_argument("--date")
    parsed = parser.parse_args(args)

    try:
        if parsed.command == "next-rc":
            print(next_release_candidate_version(parsed.version))
        elif parsed.command == "notes":
            print(
                generate_release_notes(
                    parsed.version,
                    parsed.previous_version,
                    roadmap=parsed.roadmap,
                    released_on=parsed.date,
                ),
                end="",
            )
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
