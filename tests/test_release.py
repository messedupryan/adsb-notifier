import pytest

from adsb_notifier.release import main, next_release_candidate_version


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
