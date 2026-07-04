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
"""Tests for lelab.vr — request schema, clamping, virtual-mode broadcast,
mutex rejection, and stop/status idempotence."""

from __future__ import annotations

from typing import Any

import pytest


class _FakeManager:
    """Minimal stand-in for server.ConnectionManager."""

    def __init__(self) -> None:
        self.active_connections = [object()]
        self.broadcasts: list[dict[str, Any]] = []

    def broadcast_joint_data_sync(self, data: dict[str, Any]) -> None:
        self.broadcasts.append(data)


@pytest.fixture
def idle_vr(monkeypatch: pytest.MonkeyPatch):
    """Reset lelab.vr module state to idle before (and after) each test."""
    import lelab.vr as vr

    monkeypatch.setattr(vr, "vr_session_active", False)
    monkeypatch.setattr(vr, "vr_mode", None)
    monkeypatch.setattr(vr, "current_robot", None)
    monkeypatch.setattr(vr, "_last_broadcast_time", 0.0)
    monkeypatch.setattr(vr, "_tracked_joints", dict.fromkeys(vr.URDF_JOINT_LIMITS, 0.0))
    monkeypatch.setattr(vr, "_ee_origin_pose", None)
    monkeypatch.setattr(vr, "_ee_origin_joints", None)
    return vr


def test_vr_session_request_defaults() -> None:
    from lelab.vr import VrSessionRequest

    request = VrSessionRequest()
    assert request.mode == "virtual"
    assert request.follower_port == ""
    assert request.follower_config == ""


def test_vr_session_request_rejects_unknown_mode() -> None:
    from pydantic import ValidationError

    from lelab.vr import VrSessionRequest

    with pytest.raises(ValidationError):
        VrSessionRequest(mode="hologram")


def test_clamp_joints_to_limits_clamps_and_drops_unknown() -> None:
    from lelab.vr import URDF_JOINT_LIMITS, clamp_joints_to_limits

    clamped = clamp_joints_to_limits(
        {
            "Rotation": 99.0,  # above upper
            "Pitch": -99.0,  # below lower
            "Elbow": 0.5,  # within range
            "NotAJoint": 1.0,  # unknown name
            "Jaw": "wide open",  # non-numeric
        }
    )

    assert clamped["Rotation"] == URDF_JOINT_LIMITS["Rotation"][1]
    assert clamped["Pitch"] == URDF_JOINT_LIMITS["Pitch"][0]
    assert clamped["Elbow"] == 0.5
    assert "NotAJoint" not in clamped
    assert "Jaw" not in clamped


def test_start_virtual_session_activates_without_robot(idle_vr) -> None:
    vr = idle_vr

    result = vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))

    assert result["success"] is True
    assert result["mode"] == "virtual"
    assert vr.vr_session_active is True
    assert vr.current_robot is None

    vr.handle_stop_vr_session()


def test_start_vr_session_rejected_while_teleoperation_active(
    idle_vr, monkeypatch: pytest.MonkeyPatch
) -> None:
    import lelab.teleoperate as teleop

    vr = idle_vr
    monkeypatch.setattr(teleop, "teleoperation_active", True)

    result = vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))

    assert result["success"] is False
    assert "teleoperation" in result["message"].lower()
    assert vr.vr_session_active is False


def test_joint_command_broadcasts_in_virtual_mode(idle_vr) -> None:
    vr = idle_vr
    manager = _FakeManager()

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    vr.handle_vr_joint_command({"Rotation": 0.25, "Elbow": -50.0}, manager)

    assert len(manager.broadcasts) == 1
    message = manager.broadcasts[0]
    assert message["type"] == "joint_update"
    assert message["joints"]["Rotation"] == 0.25
    assert message["joints"]["Elbow"] == vr.URDF_JOINT_LIMITS["Elbow"][0]
    assert "timestamp" in message

    vr.handle_stop_vr_session()


def test_joint_command_ignored_without_active_session(idle_vr) -> None:
    vr = idle_vr
    manager = _FakeManager()

    vr.handle_vr_joint_command({"Rotation": 0.25}, manager)

    assert manager.broadcasts == []


def test_joint_command_broadcasts_are_rate_limited(idle_vr) -> None:
    """Back-to-back commands must not each produce a broadcast (~30Hz cap);
    extras are dropped, not queued."""
    vr = idle_vr
    manager = _FakeManager()

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    for _ in range(10):
        vr.handle_vr_joint_command({"Rotation": 0.1}, manager)

    assert len(manager.broadcasts) == 1

    vr.handle_stop_vr_session()


def test_status_reports_active_session_and_stop_resets(idle_vr) -> None:
    vr = idle_vr

    assert vr.handle_vr_session_status() == {"active": False, "mode": None}

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    assert vr.handle_vr_session_status() == {"active": True, "mode": "virtual"}

    result = vr.handle_stop_vr_session()
    assert result["success"] is True
    assert vr.handle_vr_session_status() == {"active": False, "mode": None}


def test_stop_is_idempotent_when_no_session(idle_vr) -> None:
    vr = idle_vr

    first = vr.handle_stop_vr_session()
    second = vr.handle_stop_vr_session()

    assert first["success"] is False
    assert second["success"] is False
    assert vr.vr_session_active is False


def test_clamp_joints_drops_non_finite_values() -> None:
    from lelab.vr import clamp_joints_to_limits

    clamped = clamp_joints_to_limits(
        {
            "Rotation": float("nan"),
            "Pitch": float("inf"),
            "Elbow": float("-inf"),
            "Wrist_Roll": 0.1,
        }
    )

    assert clamped == {"Wrist_Roll": 0.1}


def test_start_real_session_without_follower_config_rejected(idle_vr) -> None:
    vr = idle_vr

    result = vr.handle_start_vr_session(
        vr.VrSessionRequest(mode="real", follower_port="/dev/ttyUSB0", follower_config="   ")
    )

    assert result == {
        "success": False,
        "mode": "real",
        "message": "Follower config is required for real mode",
    }
    assert vr.vr_session_active is False


def test_urdf_radians_to_action_maps_jaw_to_gripper_percent() -> None:
    """SO101 gripper.pos is percent [0, 100]; Jaw URDF limits map to the ends."""
    from lelab.vr import URDF_JOINT_LIMITS, _urdf_radians_to_action

    lower, upper = URDF_JOINT_LIMITS["Jaw"]
    robot = object()  # no calibration needed for the gripper path

    assert _urdf_radians_to_action({"Jaw": lower}, robot)["gripper.pos"] == pytest.approx(0.0)
    assert _urdf_radians_to_action({"Jaw": upper}, robot)["gripper.pos"] == pytest.approx(100.0)
    midpoint = (lower + upper) / 2
    assert _urdf_radians_to_action({"Jaw": midpoint}, robot)["gripper.pos"] == pytest.approx(50.0)


def test_start_teleoperation_rejected_while_vr_active(idle_vr, monkeypatch: pytest.MonkeyPatch) -> None:
    import lelab.record as record
    import lelab.rollout as rollout
    import lelab.teleoperate as teleop

    vr = idle_vr
    monkeypatch.setattr(vr, "vr_session_active", True)
    monkeypatch.setattr(vr, "vr_mode", "virtual")
    monkeypatch.setattr(teleop, "teleoperation_active", False)
    monkeypatch.setattr(record, "recording_active", False)
    monkeypatch.setattr(rollout, "inference_active", False)

    result = teleop.handle_start_teleoperation(
        teleop.TeleoperateRequest(
            leader_port="/dev/ttyUSB0",
            follower_port="/dev/ttyUSB1",
            leader_config="leader",
            follower_config="follower",
        )
    )

    assert result["success"] is False
    assert "vr session" in result["message"].lower()
    assert teleop.teleoperation_active is False


def test_start_recording_rejected_while_vr_active(idle_vr, monkeypatch: pytest.MonkeyPatch) -> None:
    import lelab.record as record
    import lelab.rollout as rollout
    import lelab.teleoperate as teleop

    vr = idle_vr
    monkeypatch.setattr(vr, "vr_session_active", True)
    monkeypatch.setattr(vr, "vr_mode", "virtual")
    monkeypatch.setattr(teleop, "teleoperation_active", False)
    monkeypatch.setattr(record, "recording_active", False)
    monkeypatch.setattr(rollout, "inference_active", False)

    result = record.handle_start_recording(
        record.RecordingRequest(
            leader_port="/dev/ttyUSB0",
            follower_port="/dev/ttyUSB1",
            leader_config="leader",
            follower_config="follower",
            dataset_repo_id="user/dataset",
            single_task="pick",
        )
    )

    assert result["success"] is False
    assert "vr session" in result["message"].lower()
    assert record.recording_active is False


def test_start_inference_rejected_while_vr_active(idle_vr, monkeypatch: pytest.MonkeyPatch) -> None:
    import lelab.record as record
    import lelab.rollout as rollout
    import lelab.teleoperate as teleop

    vr = idle_vr
    monkeypatch.setattr(vr, "vr_session_active", True)
    monkeypatch.setattr(vr, "vr_mode", "virtual")
    monkeypatch.setattr(teleop, "teleoperation_active", False)
    monkeypatch.setattr(record, "recording_active", False)
    monkeypatch.setattr(rollout, "inference_active", False)

    result = rollout.handle_start_inference(
        rollout.InferenceRequest(
            follower_port="/dev/ttyUSB0",
            follower_config="follower",
            policy_ref="user/repo@checkpoints/000050",
        )
    )

    assert result["success"] is False
    assert result["status_code"] == 409
    assert "vr session" in result["message"].lower()
    assert rollout.inference_active is False


class _StubBus:
    def __init__(self, on_connect) -> None:
        self._on_connect = on_connect

    def connect(self) -> None:
        self._on_connect()

    def write_calibration(self, calibration) -> None:
        pass


class _StubRobot:
    def __init__(self, on_connect) -> None:
        self.calibration: dict[str, Any] = {}
        self.bus = _StubBus(on_connect)
        self.disconnected = False

    def configure(self) -> None:
        pass

    def disconnect(self) -> None:
        self.disconnected = True


def test_stop_during_connect_releases_fresh_robot(idle_vr, monkeypatch: pytest.MonkeyPatch) -> None:
    """A stop that lands while the real-mode connect is in flight must win:
    start re-checks ownership before publishing the robot, disconnects the
    freshly connected device, and reports failure instead of leaking a
    torqued robot that no later stop can reach."""
    vr = idle_vr

    robot = _StubRobot(on_connect=vr.handle_stop_vr_session)
    monkeypatch.setattr(vr, "setup_follower_calibration_file", lambda config: "stub_config")
    monkeypatch.setattr(vr, "SO101FollowerConfig", lambda **kwargs: object())
    monkeypatch.setattr(vr, "SO101Follower", lambda config: robot)

    result = vr.handle_start_vr_session(
        vr.VrSessionRequest(mode="real", follower_port="/dev/ttyUSB0", follower_config="follower")
    )

    assert result["success"] is False
    assert "stopped during connect" in result["message"]
    assert robot.disconnected is True
    assert vr.vr_session_active is False
    assert vr.current_robot is None


def _ee_command(
    delta: dict[str, float],
    wrist_pitch_delta: float = 0.0,
    wrist_roll_delta: float = 0.0,
    gripper: float | None = None,
) -> dict[str, Any]:
    message: dict[str, Any] = {
        "type": "ee_command",
        "delta": delta,
        "wrist_pitch_delta": wrist_pitch_delta,
        "wrist_roll_delta": wrist_roll_delta,
    }
    if gripper is not None:
        message["gripper"] = gripper
    return message


def test_ee_reset_snapshots_origin_from_tracked_state(idle_vr) -> None:
    vr = idle_vr

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    vr.handle_vr_ee_reset()

    assert vr._ee_origin_pose is not None
    assert vr._ee_origin_pose.shape == (4, 4)
    assert vr._ee_origin_joints == dict.fromkeys(vr.URDF_JOINT_LIMITS, 0.0)

    vr.handle_stop_vr_session()


def test_ee_command_z_delta_broadcasts_changed_in_limit_joints(idle_vr) -> None:
    """A small +z end-effector delta must move the arm: the broadcast joint
    pose changes from all-zeros and every joint stays inside its limits."""
    vr = idle_vr
    manager = _FakeManager()

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    vr.handle_vr_ee_reset()
    vr.handle_vr_ee_command(_ee_command({"x": 0.0, "y": 0.0, "z": 0.02}), manager)

    assert len(manager.broadcasts) == 1
    message = manager.broadcasts[0]
    assert message["type"] == "joint_update"
    joints = message["joints"]
    for name in ("Rotation", "Pitch", "Elbow", "Wrist_Pitch", "Wrist_Roll"):
        lower, upper = vr.URDF_JOINT_LIMITS[name]
        assert lower <= joints[name] <= upper
    assert any(abs(joints[name]) > 1e-4 for name in ("Pitch", "Elbow"))

    vr.handle_stop_vr_session()


def test_ee_command_wrist_deltas_add_onto_origin(idle_vr) -> None:
    """Wrist joints are origin + delta (direct control), not IK output."""
    vr = idle_vr
    manager = _FakeManager()

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    vr.handle_vr_joint_command({"Wrist_Pitch": 0.2, "Wrist_Roll": -0.3}, manager)
    vr.handle_vr_ee_reset()
    vr._last_broadcast_time = 0.0  # bypass the ~30Hz broadcast rate limit
    vr.handle_vr_ee_command(
        _ee_command({"x": 0.0, "y": 0.0, "z": 0.0}, wrist_pitch_delta=0.1, wrist_roll_delta=-0.2),
        manager,
    )

    joints = manager.broadcasts[-1]["joints"]
    assert joints["Wrist_Pitch"] == pytest.approx(0.3)
    assert joints["Wrist_Roll"] == pytest.approx(-0.5)

    vr.handle_stop_vr_session()


def test_ee_command_gripper_analog_maps_to_jaw_limits(idle_vr) -> None:
    vr = idle_vr
    manager = _FakeManager()
    lower, upper = vr.URDF_JOINT_LIMITS["Jaw"]

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    vr.handle_vr_ee_reset()

    vr.handle_vr_ee_command(_ee_command({"x": 0.0, "y": 0.0, "z": 0.0}, gripper=0.0), manager)
    assert manager.broadcasts[-1]["joints"]["Jaw"] == pytest.approx(lower)

    vr._last_broadcast_time = 0.0
    vr.handle_vr_ee_command(_ee_command({"x": 0.0, "y": 0.0, "z": 0.0}, gripper=1.0), manager)
    assert manager.broadcasts[-1]["joints"]["Jaw"] == pytest.approx(upper)

    vr._last_broadcast_time = 0.0
    vr.handle_vr_ee_command(_ee_command({"x": 0.0, "y": 0.0, "z": 0.0}, gripper=0.5), manager)
    assert manager.broadcasts[-1]["joints"]["Jaw"] == pytest.approx((lower + upper) / 2)

    vr.handle_stop_vr_session()


def test_ee_command_without_reset_is_ignored(idle_vr) -> None:
    vr = idle_vr
    manager = _FakeManager()

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    vr.handle_vr_ee_command(_ee_command({"x": 0.0, "y": 0.0, "z": 0.02}), manager)

    assert manager.broadcasts == []

    vr.handle_stop_vr_session()


def test_ee_command_non_finite_delta_is_ignored(idle_vr) -> None:
    vr = idle_vr
    manager = _FakeManager()

    vr.handle_start_vr_session(vr.VrSessionRequest(mode="virtual"))
    vr.handle_vr_ee_reset()
    vr.handle_vr_ee_command(_ee_command({"x": 0.0, "y": float("nan"), "z": 0.02}), manager)
    vr.handle_vr_ee_command(_ee_command({"x": float("inf"), "y": 0.0, "z": 0.0}), manager)

    assert manager.broadcasts == []
    assert vr._tracked_joints == dict.fromkeys(vr.URDF_JOINT_LIMITS, 0.0)

    vr.handle_stop_vr_session()


def test_vr_session_endpoints_roundtrip(idle_vr, client) -> None:
    """The REST wiring: start (virtual) -> status -> stop."""
    start = client.post("/vr/session/start", json={"mode": "virtual"})
    assert start.status_code == 200
    assert start.json()["success"] is True

    status = client.get("/vr/session/status")
    assert status.json() == {"active": True, "mode": "virtual"}

    stop = client.post("/vr/session/stop")
    assert stop.json()["success"] is True

    status = client.get("/vr/session/status")
    assert status.json() == {"active": False, "mode": None}
