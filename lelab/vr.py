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

"""VR teleoperation sessions.

A VR client (headset controlling the arm through the browser) sends
``joint_command`` messages over the existing ``/ws/joint-data`` WebSocket.
In *virtual* mode the commands only drive the in-browser puppet: they are
clamped to joint limits and echoed back to every client as ``joint_update``.
In *real* mode they are additionally converted to motor degrees and sent to a
connected SO101 follower arm.

Unlike teleoperation there is no worker thread — the session is command-driven:
each incoming WebSocket message is handled synchronously.
"""

import logging
import math
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Any, Literal

import numpy as np
from pydantic import BaseModel

from lerobot.robots.so_follower import SO101Follower, SO101FollowerConfig

from .teleoperate import _SO101_URDF_CORRECTIONS, _STS3215_MAX_RES
from .utils.config import setup_follower_calibration_file
from .utils.devices import safe_disconnect_device

logger = logging.getLogger(__name__)

# Joint limits in radians, taken from
# frontend/public/so-101-urdf/urdf/so101_new_calib.urdf (<joint><limit lower upper>).
# Hardcoded so the backend does not need to parse frontend assets at runtime.
URDF_JOINT_LIMITS: dict[str, tuple[float, float]] = {
    "Rotation": (-1.91986, 1.91986),
    "Pitch": (-1.74533, 1.74533),
    "Elbow": (-1.74533, 1.5708),
    "Wrist_Pitch": (-1.65806, 1.65806),
    "Wrist_Roll": (-2.79253, 2.79253),
    "Jaw": (-0.174533, 1.74533),
}

# Inverse of the motor->URDF mapping in teleoperate.get_joint_positions_from_robot.
URDF_TO_MOTOR_MAPPING = {
    "Rotation": "shoulder_pan",
    "Pitch": "shoulder_lift",
    "Elbow": "elbow_flex",
    "Wrist_Pitch": "wrist_flex",
    "Wrist_Roll": "wrist_roll",
    "Jaw": "gripper",
}

# Max joint_update broadcast rate for VR commands; extra commands are dropped
# from the broadcast (never queued) so slow clients don't build up lag.
_BROADCAST_INTERVAL = 1.0 / 30.0

# Global variables for VR session state
vr_session_active = False
vr_mode: str | None = None
current_robot = None
# Guards the start/stop paths so concurrent callers can't double-claim.
_state_lock = threading.Lock()
_last_broadcast_time = 0.0

# End-effector (grip-to-move) control. Position IK drives the first three
# joints; the wrist joints are set directly from the grip-origin pose plus the
# controller's rotation deltas (telegrip pattern: IK never fights the wrist).
_IK_JOINT_NAMES = ["Rotation", "Pitch", "Elbow", "Wrist_Pitch", "Wrist_Roll"]
_URDF_EE_FRAME = "gripper"
_MESH_PACKAGE_PREFIX = "package://so_arm_description/meshes/"

_kinematics = None
_kinematics_failed = False
# Last commanded/broadcast joint state (URDF names -> radians). Seeds FK/IK.
_tracked_joints: dict[str, float] = dict.fromkeys(URDF_JOINT_LIMITS, 0.0)
# Grip origin snapshot taken by ee_reset: FK pose (4x4) and joint state.
_ee_origin_pose: np.ndarray | None = None
_ee_origin_joints: dict[str, float] | None = None


def _find_urdf_dir() -> Path | None:
    """Locate the so-101-urdf assets dir; prefer public/ (dev), else dist/."""
    frontend = Path(__file__).parent.parent / "frontend"
    for sub in ("public", "dist"):
        candidate = frontend / sub / "so-101-urdf"
        if (candidate / "urdf" / "so101_new_calib.urdf").is_file():
            return candidate
    return None


def _get_kinematics():
    """Lazily build and cache the placo-backed RobotKinematics solver.

    placo cannot resolve the URDF's ``package://`` mesh URIs, so a copy with
    the mesh paths rewritten to the absolute meshes directory is written to a
    temp file once per process. Returns None (and logs once) when the URDF or
    placo is unavailable — EE commands are then ignored.

    Note: RobotKinematics.forward_kinematics / inverse_kinematics take and
    return joint values in *degrees*.
    """
    global _kinematics, _kinematics_failed
    if _kinematics is not None:
        return _kinematics
    if _kinematics_failed:
        return None
    try:
        from lerobot.model.kinematics import RobotKinematics

        urdf_dir = _find_urdf_dir()
        if urdf_dir is None:
            raise FileNotFoundError("so-101-urdf not found under frontend/public or frontend/dist")
        source = urdf_dir / "urdf" / "so101_new_calib.urdf"
        rewritten = Path(tempfile.gettempdir()) / f"lelab_so101_ik_{os.getpid()}.urdf"
        rewritten.write_text(source.read_text().replace(_MESH_PACKAGE_PREFIX, f"{urdf_dir / 'meshes'}/"))
        _kinematics = RobotKinematics(str(rewritten), _URDF_EE_FRAME, _IK_JOINT_NAMES)
    except Exception as e:
        _kinematics_failed = True
        logger.error(f"VR end-effector control unavailable (kinematics init failed): {e}")
        return None
    return _kinematics


def _as_finite_float(value: Any) -> float | None:
    if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
        return None
    return float(value)


class VrSessionRequest(BaseModel):
    mode: Literal["virtual", "real"] = "virtual"
    follower_port: str = ""
    follower_config: str = ""


def clamp_joints_to_limits(joints: dict[str, Any]) -> dict[str, float]:
    """Clamp URDF joint values (radians) to the URDF limits.

    Unknown joint names and non-numeric values are dropped.
    """
    clamped: dict[str, float] = {}
    for name, value in joints.items():
        limits = URDF_JOINT_LIMITS.get(name)
        if limits is None:
            logger.debug(f"Ignoring unknown VR joint: {name}")
            continue
        if not isinstance(value, (int, float)) or isinstance(value, bool) or not math.isfinite(value):
            logger.debug(f"Ignoring non-numeric VR joint value for {name}: {value!r}")
            continue
        lower, upper = limits
        clamped[name] = min(max(float(value), lower), upper)
    return clamped


def _urdf_radians_to_action(joints: dict[str, float], robot) -> dict[str, float]:
    """Convert clamped URDF joint radians into a motor-space action dict.

    Inverts the URDF correction applied in teleoperate.get_joint_positions_from_robot:
        urdf_deg = sign * (motor_deg - motor_at_urdf_zero)
    so
        motor_deg = sign * urdf_deg + motor_at_urdf_zero.
    """
    calibration = getattr(robot, "calibration", None) or {}
    action: dict[str, float] = {}
    for urdf_name, radians in joints.items():
        motor_name = URDF_TO_MOTOR_MAPPING[urdf_name]
        if motor_name == "gripper":
            # SO101 gripper.pos expects percent [0, 100], not degrees: map the
            # Jaw URDF range linearly (lower limit -> 0%, upper limit -> 100%).
            lower, upper = URDF_JOINT_LIMITS["Jaw"]
            action["gripper.pos"] = (radians - lower) / (upper - lower) * 100.0
            continue
        angle_degrees = radians * 180.0 / math.pi
        correction = _SO101_URDF_CORRECTIONS.get(motor_name)
        if correction is not None and motor_name in calibration:
            sign, urdf_zero_ticks = correction
            cal = calibration[motor_name]
            mid = (cal.range_min + cal.range_max) / 2
            motor_at_urdf_zero = (urdf_zero_ticks - mid) * 360 / _STS3215_MAX_RES
            angle_degrees = sign * angle_degrees + motor_at_urdf_zero
        action[f"{motor_name}.pos"] = angle_degrees
    return action


def handle_start_vr_session(request: VrSessionRequest, websocket_manager=None) -> dict[str, Any]:
    """Handle start VR session request.

    Virtual mode only flips the session flag. Real mode connects to the
    follower arm *synchronously* so a connection failure is reported back to
    the caller instead of dying silently later.
    """
    global vr_session_active, vr_mode, current_robot, _ee_origin_pose, _ee_origin_joints

    from . import record as _record, rollout as _rollout, teleoperate as _teleoperate

    if request.mode == "real" and not request.follower_config.strip():
        return {
            "success": False,
            "mode": "real",
            "message": "Follower config is required for real mode",
        }

    with _state_lock:
        if vr_session_active:
            return {"success": False, "mode": vr_mode, "message": "A VR session is already active"}
        if _teleoperate.teleoperation_active:
            return {
                "success": False,
                "mode": request.mode,
                "message": "Teleoperation is currently active. Stop it first.",
            }
        if _record.recording_active:
            return {
                "success": False,
                "mode": request.mode,
                "message": "Recording is currently active. Stop it first.",
            }
        if _rollout.inference_active:
            return {
                "success": False,
                "mode": request.mode,
                "message": "Inference is currently active. Stop it first.",
            }
        # Claim the slot now so a concurrent caller losing the race sees us.
        vr_session_active = True
        vr_mode = request.mode
        # Fresh session: no grip origin yet, joint state back to the default
        # all-zeros pose (matches the puppet the frontend loads).
        _ee_origin_pose = None
        _ee_origin_joints = None
        _tracked_joints.update(dict.fromkeys(URDF_JOINT_LIMITS, 0.0))

    if request.mode == "virtual":
        logger.info("VR session started (virtual mode)")
        return {"success": True, "mode": "virtual", "message": "VR session started (virtual mode)"}

    robot = None
    try:
        logger.info(f"Starting VR session with follower port: {request.follower_port}")

        follower_config_name = setup_follower_calibration_file(request.follower_config)
        robot_config = SO101FollowerConfig(
            port=request.follower_port,
            id=follower_config_name,
        )
        robot = SO101Follower(robot_config)

        logger.info("Connecting to follower arm...")
        try:
            robot.bus.connect()
        except Exception as e:
            raise RuntimeError(
                f"Could not connect to the follower arm on {request.follower_port}. "
                "Make sure it's plugged in and powered on, then try again."
            ) from e

        logger.info("Writing calibration to motors...")
        robot.bus.write_calibration(robot.calibration)
        robot.configure()
        logger.info("Successfully connected to follower arm")

        # The multi-second connect ran outside the lock; a concurrent stop may
        # have released our claim in the meantime. Only publish the robot if
        # this call still owns the session — otherwise the robot would be
        # leaked, torqued and unreachable by any later stop.
        with _state_lock:
            if not (vr_session_active and vr_mode == "real"):
                safe_disconnect_device(robot, logger, context="VR session stopped during connect")
                return {
                    "success": False,
                    "mode": "real",
                    "message": "VR session was stopped during connect",
                }
            current_robot = robot
        return {"success": True, "mode": "real", "message": "VR session started (real mode)"}

    except Exception as e:
        # Connection (or setup) failed: release the device, reset state, and
        # surface the error. str(e) is already a user-facing message for the
        # connection failure raised above. Only clear the flags if this call
        # still owns the session (a concurrent stop may have reset them and a
        # new session may have claimed the slot since).
        safe_disconnect_device(robot, logger, context="VR session start failure")
        with _state_lock:
            if vr_session_active and vr_mode == "real":
                vr_session_active = False
                vr_mode = None
                current_robot = None
        logger.error(f"Failed to start VR session: {e}")
        return {"success": False, "mode": "real", "message": str(e)}


def _dispatch_vr_joints(clamped: dict[str, float], websocket_manager=None) -> None:
    """Shared tail for joint_command and ee_command dispatch.

    Tracks the commanded state, drives the follower arm in real mode, and
    echoes the clamped pose to all WS clients as a joint_update (rate-limited
    to ~30Hz; extra commands are dropped, never queued).
    """
    global _last_broadcast_time

    _tracked_joints.update(clamped)

    if vr_mode == "real" and current_robot is not None:
        try:
            action = _urdf_radians_to_action(clamped, current_robot)
            current_robot.send_action(action)
        except Exception as e:
            logger.error(f"Error sending VR action to robot: {e}")

    now = time.monotonic()
    if now - _last_broadcast_time < _BROADCAST_INTERVAL:
        return
    _last_broadcast_time = now

    if websocket_manager and websocket_manager.active_connections:
        try:
            websocket_manager.broadcast_joint_data_sync(
                {"type": "joint_update", "joints": clamped, "timestamp": time.time()}
            )
        except Exception as e:
            logger.error(f"Error broadcasting VR joint data: {e}")


def handle_vr_joint_command(joints: dict[str, Any], websocket_manager=None) -> None:
    """Handle a joint_command message from the /ws/joint-data WebSocket."""
    if not vr_session_active:
        logger.debug("Ignoring joint_command: no active VR session")
        return

    clamped = clamp_joints_to_limits(joints)
    if not clamped:
        return

    _dispatch_vr_joints(clamped, websocket_manager)


def handle_vr_ee_reset() -> None:
    """Handle an ee_reset message: snapshot the grip origin.

    Records the current joint state and its FK pose so subsequent ee_command
    deltas move the end-effector relative to where the arm is *now* (the
    grip-to-move clutch: every grip press re-anchors here).
    """
    global _ee_origin_pose, _ee_origin_joints

    if not vr_session_active:
        logger.debug("Ignoring ee_reset: no active VR session")
        return
    kinematics = _get_kinematics()
    if kinematics is None:
        return

    q_rad = np.array([_tracked_joints[name] for name in _IK_JOINT_NAMES])
    _ee_origin_pose = kinematics.forward_kinematics(np.degrees(q_rad))
    _ee_origin_joints = dict(_tracked_joints)


def handle_vr_ee_command(message: dict[str, Any], websocket_manager=None) -> None:
    """Handle an ee_command message: grip-to-move end-effector control.

    The frontend sends position deltas already mapped into the robot frame
    (meters), wrist pitch/roll deltas (radians) relative to the grip origin,
    and the trigger analog (0..1) for the gripper. Position IK (seeded with
    the current joint vector) drives Rotation/Pitch/Elbow; the wrist joints
    are set directly from origin + delta so IK never fights the wrist.
    """
    if not vr_session_active:
        logger.debug("Ignoring ee_command: no active VR session")
        return
    if _ee_origin_pose is None or _ee_origin_joints is None:
        logger.debug("Ignoring ee_command: no ee_reset origin")
        return
    kinematics = _get_kinematics()
    if kinematics is None:
        return

    delta = message.get("delta")
    if not isinstance(delta, dict):
        logger.debug("Ignoring ee_command: missing delta")
        return
    dx = _as_finite_float(delta.get("x"))
    dy = _as_finite_float(delta.get("y"))
    dz = _as_finite_float(delta.get("z"))
    wrist_pitch_delta = _as_finite_float(message.get("wrist_pitch_delta", 0.0))
    wrist_roll_delta = _as_finite_float(message.get("wrist_roll_delta", 0.0))
    if None in (dx, dy, dz, wrist_pitch_delta, wrist_roll_delta):
        logger.debug("Ignoring ee_command: non-finite or non-numeric value")
        return

    target = _ee_origin_pose.copy()
    target[0, 3] += dx
    target[1, 3] += dy
    target[2, 3] += dz

    # Seed IK with the current joint vector: far seeds can return wound-up
    # solutions. RobotKinematics works in degrees.
    q_seed_deg = np.degrees([_tracked_joints[name] for name in _IK_JOINT_NAMES])
    solution_rad = np.radians(kinematics.inverse_kinematics(q_seed_deg, target))

    joints: dict[str, float] = {
        "Rotation": solution_rad[0],
        "Pitch": solution_rad[1],
        "Elbow": solution_rad[2],
        "Wrist_Pitch": _ee_origin_joints["Wrist_Pitch"] + wrist_pitch_delta,
        "Wrist_Roll": _ee_origin_joints["Wrist_Roll"] + wrist_roll_delta,
    }
    gripper = _as_finite_float(message.get("gripper"))
    if gripper is not None:
        # Same convention as the frontend stick mapping: 0 -> Jaw lower limit
        # (closed), 1 -> Jaw upper limit (open).
        lower, upper = URDF_JOINT_LIMITS["Jaw"]
        joints["Jaw"] = lower + min(max(gripper, 0.0), 1.0) * (upper - lower)

    clamped = clamp_joints_to_limits(joints)
    if not clamped:
        return

    _dispatch_vr_joints(clamped, websocket_manager)


def handle_stop_vr_session() -> dict[str, Any]:
    """Handle stop VR session request. Disconnects the follower arm if any."""
    global vr_session_active, vr_mode, current_robot

    with _state_lock:
        if not vr_session_active:
            return {"success": False, "message": "No VR session is active"}
        vr_session_active = False
        vr_mode = None
        robot = current_robot
        current_robot = None

    safe_disconnect_device(robot, logger, context="VR session stop")
    logger.info("VR session stopped")
    return {"success": True, "message": "VR session stopped successfully"}


def handle_vr_session_status() -> dict[str, Any]:
    """Handle VR session status request."""
    return {"active": vr_session_active, "mode": vr_mode}
