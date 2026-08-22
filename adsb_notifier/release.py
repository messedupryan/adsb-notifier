"""Release-version helpers for Makefile workflows."""

from __future__ import annotations

import re
import sys


VERSION_RE = re.compile(r"^0\.(?P<minor>\d+)\.(?P<patch>\d+)(?:-rc\.(?P<rc>\d+))?$")


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


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 2 or args[0] != "next-rc":
        print("Usage: python -m adsb_notifier.release next-rc 0.x.y[-rc.n]", file=sys.stderr)
        return 2
    try:
        print(next_release_candidate_version(args[1]))
    except ValueError as exc:
        print(str(exc), file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
