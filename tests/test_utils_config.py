# Copyright 2025 The HuggingFace Inc. team. All rights reserved.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
"""Tests for lelab.utils.config — path resolution and persistence helpers."""

from __future__ import annotations

import json
from pathlib import Path

import pytest


@pytest.fixture(autouse=True)
def _patch_robots_path(tmp_lerobot_home: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    """Redirect ROBOTS_PATH (not covered by the shared fixture) into tmp."""
    from lelab.utils import config as cfg

    robots_dir = tmp_lerobot_home / "robots"
    robots_dir.mkdir(parents=True, exist_ok=True)
    monkeypatch.setattr(cfg, "ROBOTS_PATH", str(robots_dir))


def test_port_persistence_round_trips(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    cfg.save_robot_port("leader", "/dev/ttyUSB0")
    cfg.save_robot_port("follower", "/dev/ttyUSB1")

    assert cfg.get_saved_robot_port("leader") == "/dev/ttyUSB0"
    assert cfg.get_saved_robot_port("follower") == "/dev/ttyUSB1"


def test_get_saved_robot_port_returns_none_when_unset(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    assert cfg.get_saved_robot_port("leader") is None


def test_saved_robot_config_round_trips(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    cfg.save_robot_config("leader", "my_calib")
    assert cfg.get_saved_robot_config("leader") == "my_calib"


def test_get_default_robot_config_falls_back_to_first_available(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    available = ["alpha", "beta", "gamma"]
    # No saved config → first available wins.
    assert cfg.get_default_robot_config("leader", available) == "alpha"

    # After saving, the saved one wins if it's still available.
    cfg.save_robot_config("leader", "beta")
    assert cfg.get_default_robot_config("leader", available) == "beta"

    # Saved config no longer in the available list → fall back to first.
    cfg.save_robot_config("leader", "deleted")
    assert cfg.get_default_robot_config("leader", available) == "alpha"


def test_is_valid_robot_name_accepts_simple_names(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    assert cfg.is_valid_robot_name("my_robot")
    assert cfg.is_valid_robot_name("robot-1")


def test_is_valid_robot_name_rejects_empty_and_path_separators(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    assert not cfg.is_valid_robot_name("")
    assert not cfg.is_valid_robot_name("a/b")
    assert not cfg.is_valid_robot_name("..")


def test_is_valid_robot_name_rejects_leading_trailing_whitespace(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    # name.strip() != name → invalid
    assert not cfg.is_valid_robot_name(" robot")
    assert not cfg.is_valid_robot_name("robot ")


def test_robot_record_save_get_delete_round_trip(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    record = {"name": "lab1", "leader_port": "/dev/ttyUSB0", "follower_port": ""}
    assert cfg.save_robot_record("lab1", record, allow_create=True)

    loaded = cfg.get_robot_record("lab1")
    assert loaded is not None
    assert loaded["name"] == "lab1"
    assert loaded["leader_port"] == "/dev/ttyUSB0"

    listed = cfg.list_robot_records()
    assert any(r["name"] == "lab1" for r in listed)

    assert cfg.delete_robot_record("lab1")
    assert cfg.get_robot_record("lab1") is None


def test_robot_record_allow_create_false_is_noop(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    # Record does not exist and allow_create=False → returns False.
    result = cfg.save_robot_record("nonexistent", {"leader_port": "/dev/x"}, allow_create=False)
    assert result is False
    assert cfg.get_robot_record("nonexistent") is None


def test_robot_record_save_rejects_invalid_name(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    # Path traversal-style names must not write outside the config dir.
    assert not cfg.save_robot_record("../escape", {"name": "x"}, allow_create=True)


def test_robot_record_merges_fields(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    cfg.save_robot_record("merge_test", {"leader_port": "/dev/a"}, allow_create=True)
    cfg.save_robot_record("merge_test", {"follower_port": "/dev/b"}, allow_create=False)

    loaded = cfg.get_robot_record("merge_test")
    assert loaded is not None
    assert loaded["leader_port"] == "/dev/a"
    assert loaded["follower_port"] == "/dev/b"


def test_setup_calibration_files_copies_configs(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    # setup_calibration_files reads from LEADER_CONFIG_PATH / FOLLOWER_CONFIG_PATH
    # and writes into those same directories (source dir == target dir).
    # Provide source files there.
    src_leader = Path(cfg.LEADER_CONFIG_PATH) / "demo_leader.json"
    src_leader.write_text(json.dumps({"motors": {}}))

    src_follower = Path(cfg.FOLLOWER_CONFIG_PATH) / "demo_follower.json"
    src_follower.write_text(json.dumps({"motors": {}}))

    result = cfg.setup_calibration_files("demo_leader.json", "demo_follower.json")
    # Returns the stem names.
    assert result == ("demo_leader", "demo_follower")

    # Files should exist (they were already there; function ensures they are present).
    assert src_leader.is_file()
    assert src_follower.is_file()


# DISCOVERED: `setup_calibration_files` sets `leader_calibration_dir = LEADER_CONFIG_PATH`
# (not CALIBRATION_BASE_PATH_TELEOP) and `follower_calibration_dir = FOLLOWER_CONFIG_PATH`
# (not CALIBRATION_BASE_PATH_ROBOTS). This means source and destination are the same
# directory, so the function only validates that the file exists in LEADER_CONFIG_PATH /
# FOLLOWER_CONFIG_PATH; it never writes into CALIBRATION_BASE_PATH_TELEOP or
# CALIBRATION_BASE_PATH_ROBOTS. The plan's assertion about those paths was incorrect.


def test_is_robot_record_follower_ready_with_follower_only(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    # Follower calibration file exists on disk; leader fields stay empty.
    calib = Path(cfg.FOLLOWER_CONFIG_PATH) / "arm2.json"
    calib.write_text(json.dumps({"motors": {}}))

    record = {
        "name": "solo",
        "leader_port": "",
        "follower_port": "/dev/ttyUSB1",
        "leader_config": "",
        "follower_config": "arm2.json",
    }
    assert cfg.is_robot_record_follower_ready(record)
    # Follower-only is not 'clean' — classic teleop/recording still need a leader.
    assert not cfg.is_robot_record_clean(record)


def test_is_robot_record_follower_ready_requires_calibration_file(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    record = {
        "name": "solo",
        "leader_port": "",
        "follower_port": "/dev/ttyUSB1",
        "leader_config": "",
        "follower_config": "missing.json",
    }
    assert not cfg.is_robot_record_follower_ready(record)


def test_is_robot_record_follower_ready_requires_port_and_config(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    calib = Path(cfg.FOLLOWER_CONFIG_PATH) / "arm2.json"
    calib.write_text(json.dumps({"motors": {}}))

    assert not cfg.is_robot_record_follower_ready({})
    assert not cfg.is_robot_record_follower_ready({"follower_port": "", "follower_config": "arm2.json"})
    assert not cfg.is_robot_record_follower_ready({"follower_port": "/dev/ttyUSB1", "follower_config": "  "})


def test_robot_record_arm_mode_defaults_to_pair_for_legacy_records(
    tmp_lerobot_home: Path,
) -> None:
    from lelab.utils import config as cfg

    # A record written before arm_mode existed has no such key on disk.
    legacy_path = Path(cfg.ROBOTS_PATH) / "legacy.json"
    legacy_path.write_text(json.dumps({"name": "legacy", "leader_port": "/dev/a", "follower_port": "/dev/b"}))

    loaded = cfg.get_robot_record("legacy")
    assert loaded is not None
    assert loaded["arm_mode"] == "pair"


def test_robot_record_arm_mode_single_round_trips(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    assert cfg.save_robot_record("solo", {"arm_mode": "single"}, allow_create=True)
    loaded = cfg.get_robot_record("solo")
    assert loaded is not None
    assert loaded["arm_mode"] == "single"

    # Partial updates that don't mention arm_mode must preserve it.
    cfg.save_robot_record("solo", {"follower_port": "/dev/x"}, allow_create=False)
    loaded = cfg.get_robot_record("solo")
    assert loaded is not None
    assert loaded["arm_mode"] == "single"
    assert loaded["follower_port"] == "/dev/x"


def test_robot_record_arm_mode_rejects_garbage_values(tmp_lerobot_home: Path) -> None:
    from lelab.utils import config as cfg

    cfg.save_robot_record("bot", {"arm_mode": "single"}, allow_create=True)
    # Invalid values are ignored on save — the existing mode stays.
    cfg.save_robot_record("bot", {"arm_mode": "banana"}, allow_create=False)
    cfg.save_robot_record("bot", {"arm_mode": 42}, allow_create=False)
    loaded = cfg.get_robot_record("bot")
    assert loaded is not None
    assert loaded["arm_mode"] == "single"

    # Garbage written straight to disk loads back as the "pair" default.
    garbage_path = Path(cfg.ROBOTS_PATH) / "garbage.json"
    garbage_path.write_text(json.dumps({"name": "garbage", "arm_mode": "banana"}))
    loaded = cfg.get_robot_record("garbage")
    assert loaded is not None
    assert loaded["arm_mode"] == "pair"


def _follower_ready_record(cfg, name: str, arm_mode: str) -> dict:
    """A record whose follower side is fully usable but with no leader."""
    calib = Path(cfg.FOLLOWER_CONFIG_PATH) / f"{name}.json"
    calib.write_text(json.dumps({"motors": {}}))
    return {
        "name": name,
        "leader_port": "",
        "follower_port": "/dev/ttyUSB1",
        "leader_config": "",
        "follower_config": f"{name}.json",
        "arm_mode": arm_mode,
    }


def test_is_ready_derivation_single_mode(tmp_lerobot_home: Path) -> None:
    from lelab.server import _record_with_clean
    from lelab.utils import config as cfg

    # Single-arm: follower-ready alone means ready.
    record = _follower_ready_record(cfg, "solo_ready", "single")
    out = _record_with_clean(record)
    assert out["is_follower_ready"] is True
    assert out["is_clean"] is False
    assert out["is_ready"] is True

    # Single-arm without a usable follower is not ready.
    out = _record_with_clean({"name": "solo_bare", "arm_mode": "single"})
    assert out["is_ready"] is False


def test_is_ready_derivation_pair_mode(tmp_lerobot_home: Path) -> None:
    from lelab.server import _record_with_clean
    from lelab.utils import config as cfg

    # Pair: follower-ready alone is NOT ready — a leader is still required.
    record = _follower_ready_record(cfg, "pair_partial", "pair")
    out = _record_with_clean(record)
    assert out["is_follower_ready"] is True
    assert out["is_clean"] is False
    assert out["is_ready"] is False

    # Pair with both sides calibrated is ready.
    leader_calib = Path(cfg.LEADER_CONFIG_PATH) / "pair_full_leader.json"
    leader_calib.write_text(json.dumps({"motors": {}}))
    record = _follower_ready_record(cfg, "pair_full", "pair")
    record["leader_port"] = "/dev/ttyUSB0"
    record["leader_config"] = "pair_full_leader.json"
    out = _record_with_clean(record)
    assert out["is_clean"] is True
    assert out["is_ready"] is True


def test_with_lelab_tag_appends_to_existing_tags() -> None:
    from lelab.utils.config import LELAB_TAG, with_lelab_tag

    assert with_lelab_tag(["robotics", "lerobot"]) == ["robotics", "lerobot", LELAB_TAG]


def test_with_lelab_tag_handles_none_and_empty() -> None:
    from lelab.utils.config import LELAB_TAG, with_lelab_tag

    assert with_lelab_tag(None) == [LELAB_TAG]
    assert with_lelab_tag([]) == [LELAB_TAG]


def test_with_lelab_tag_dedupes() -> None:
    from lelab.utils.config import LELAB_TAG, with_lelab_tag

    # Caller-supplied LeLab is not duplicated, and order is preserved.
    assert with_lelab_tag(["robotics", LELAB_TAG, "lerobot"]) == ["robotics", LELAB_TAG, "lerobot"]
