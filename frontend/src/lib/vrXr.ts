import {
  BufferGeometry,
  GridHelper,
  Group,
  HemisphereLight,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { URDFViewerElement } from "@/lib/urdfViewerHelpers";

// Joint limits (radians) hardcoded from
// frontend/public/so-101-urdf/urdf/so101_new_calib.urdf <joint><limit lower upper>.
export const JOINT_LIMITS: Record<string, readonly [number, number]> = {
  Rotation: [-1.91986, 1.91986],
  Pitch: [-1.74533, 1.74533],
  Elbow: [-1.74533, 1.5708],
  Wrist_Pitch: [-1.65806, 1.65806],
  Wrist_Roll: [-2.79253, 2.79253],
  Jaw: [-0.174533, 1.74533],
};

export const JOINT_NAMES = Object.keys(JOINT_LIMITS);

export const clampToLimits = (joint: string, value: number): number => {
  const limits = JOINT_LIMITS[joint];
  if (!limits) return value;
  return Math.min(limits[1], Math.max(limits[0], value));
};

const STICK_RATE_RAD_PER_S = 1.5;
const DEADZONE = 0.15;
const JAW_ENGAGE_THRESHOLD = 0.05;
const SEND_INTERVAL_MS = 50; // 20 Hz
// Grip-to-move end-effector control (right controller).
const GRIP_PRESS_THRESHOLD = 0.5;
// Controller meters -> robot meters; telegrip's vr_to_robot_scale default
// (telegrip/config.py:39).
const VR_TO_ROBOT_SCALE = 1.0;
const MIN_ROTATION_ANGLE_RAD = 1e-4;
const CHANGE_EPSILON = 1e-3;
// Place the arm base above the floor and in front of the viewer start pose.
const ROBOT_XR_HEIGHT_M = 0.75;
const ROBOT_XR_DISTANCE_M = 0.6;

export const isVrSupported = async (): Promise<boolean> => {
  if (typeof navigator === "undefined" || !navigator.xr) return false;
  try {
    return await navigator.xr.isSessionSupported("immersive-vr");
  } catch {
    return false;
  }
};

const applyDeadzone = (value: number): number =>
  Math.abs(value) < DEADZONE ? 0 : value;

// xr-standard gamepad mapping: thumbstick lives on axes[2]/[3]
// (axes[0]/[1] are the touchpad); fall back for two-axis gamepads.
const readStick = (gamepad: Gamepad): { x: number; y: number } => {
  const x = gamepad.axes.length >= 4 ? gamepad.axes[2] : gamepad.axes[0] ?? 0;
  const y = gamepad.axes.length >= 4 ? gamepad.axes[3] : gamepad.axes[1] ?? 0;
  return { x: applyDeadzone(x), y: applyDeadzone(y) };
};

interface VrSessionOptions {
  // Sends a joint_command over /ws/joint-data; returns false when the socket is down.
  sendJoints: (joints: Record<string, number>) => boolean;
  // Sends an arbitrary message over /ws/joint-data (ee_reset / ee_command).
  sendMessage: (message: Record<string, unknown>) => boolean;
  // Fired when right-grip end-effector control engages/disengages, so the
  // page can let the authoritative joint_update echoes through while the
  // backend IK drives the pose (and re-suppress them for stick mode).
  onEeGripChange?: (active: boolean) => void;
}

interface VrSessionHandle {
  ok: true;
  session: XRSession;
  end: () => void;
}

interface VrSessionFailure {
  ok: false;
  error: string;
}

export type VrSessionResult = VrSessionHandle | VrSessionFailure;

// WebXR local-floor space (x=right, y=up, z=back/towards user) -> SO101 robot
// frame, mirroring telegrip's vr_to_robot_coordinates()
// (telegrip/core/kinematics.py:346-357): robot = (-vr.x, vr.z, vr.y) * scale.
const xrDeltaToRobotFrame = (
  delta: Vector3
): { x: number; y: number; z: number } => ({
  x: -delta.x * VR_TO_ROBOT_SCALE,
  y: delta.z * VR_TO_ROBOT_SCALE,
  z: delta.y * VR_TO_ROBOT_SCALE,
});

// Rotation vector (axis * angle, radians) of the relative rotation
// origin -> current, mirroring telegrip's
// extract_roll/extract_pitch_from_quaternion (vr_ws_server.py:414-460), which
// take scipy's as_rotvec() of current * origin^-1. Canonicalized to the
// shortest rotation (angle in [0, pi]) like scipy does.
const relativeRotationVector = (
  current: Quaternion,
  origin: Quaternion
): Vector3 => {
  const relative = current.clone().multiply(origin.clone().invert());
  const w = Math.min(1, Math.max(-1, relative.w));
  const angle = 2 * Math.acos(Math.abs(w));
  if (angle < MIN_ROTATION_ANGLE_RAD) return new Vector3(0, 0, 0);
  const sinHalfAngle = Math.sqrt(1 - w * w);
  const axis = new Vector3(
    relative.x / sinHalfAngle,
    relative.y / sinHalfAngle,
    relative.z / sinHalfAngle
  );
  if (relative.w < 0) axis.negate();
  return axis.multiplyScalar(angle);
};

/**
 * Starts an immersive-vr session on the given urdf-viewer element.
 *
 * Primary interaction — grip-to-move end-effector control (RIGHT controller):
 *   RIGHT grip press      -> ee_reset (backend snapshots the arm pose as the
 *                            origin) + controller pose snapshot
 *   RIGHT grip held       -> ee_command at 20 Hz: controller position delta
 *                            mapped into the robot frame moves the
 *                            end-effector via IK; controller roll/pitch
 *                            deltas drive the wrist joints; trigger analog
 *                            (0..1) drives the gripper
 *   RIGHT grip release    -> clutch: nothing is sent, reposition the hand
 *                            freely, press grip again to continue
 * While the grip is held, stick joint control is suspended and the backend's
 * joint_update echoes are authoritative for the viewer pose.
 *
 * Stick joint mapping (deltas at ~1.5 rad/s full deflection, deadzone 0.15,
 * clamped to JOINT_LIMITS):
 *   LEFT stick X          -> Rotation
 *   LEFT stick Y (fwd)    -> Pitch
 *   RIGHT stick Y (fwd)   -> Elbow
 *   RIGHT stick X         -> Wrist_Roll
 *   LEFT trigger          -> Wrist_Pitch down
 *   LEFT grip             -> Wrist_Pitch up
 *   RIGHT trigger (0..1)  -> Jaw absolute, closed..open across its limit
 *                            range (inactive until first pressed > 0.05)
 */
export const startVrSession = async (
  viewer: URDFViewerElement,
  options: VrSessionOptions
): Promise<VrSessionResult> => {
  if (typeof navigator === "undefined" || !navigator.xr) {
    return { ok: false, error: "WebXR is not available in this browser" };
  }

  let session: XRSession;
  try {
    session = await navigator.xr.requestSession("immersive-vr", {
      optionalFeatures: ["local-floor"],
    });
  } catch (err) {
    return { ok: false, error: `Could not start VR session: ${err}` };
  }

  const { renderer, scene, camera } = viewer;

  // The element's own rAF loop calls updateSize() every frame, and three's
  // renderer warns on every setSize/setPixelRatio while an XR session is
  // presenting. Shadow the method with a guard for the session's duration.
  const originalUpdateSize = viewer.updateSize;
  viewer.updateSize = () => {
    if (!renderer.xr.isPresenting) originalUpdateSize.call(viewer);
  };
  const hadAutoRedraw = viewer.hasAttribute("auto-redraw");
  viewer.removeAttribute("auto-redraw");

  // setJointValue -> redraw() marks the element dirty and its own window-rAF
  // _renderLoop would render the canvas outside (and competing with) the XR
  // frame loop. Shadow redraw for the session so the element never goes dirty
  // while presenting; the XR loop renders every frame anyway.
  const originalRedraw = viewer.redraw;
  viewer.redraw = () => {
    if (!renderer.xr.isPresenting) originalRedraw.call(viewer);
  };

  // Position the robot for XR: local-floor puts y=0 at the floor and the
  // viewer at the origin, looking down -Z.
  const originalWorldPosition = viewer.world.position.clone();
  viewer.world.position.set(0, ROBOT_XR_HEIGHT_M, -ROBOT_XR_DISTANCE_M);

  // XR-only floor grid + fill light (removed when the session ends).
  const xrExtras = new Group();
  xrExtras.add(new GridHelper(4, 20, 0x888888, 0x444444));
  xrExtras.add(new HemisphereLight(0xffffff, 0x38383f, 1));
  scene.add(xrExtras);

  // Controller ray lines + grip spheres so hands are visible.
  const rayGeometry = new BufferGeometry().setFromPoints([
    new Vector3(0, 0, 0),
    new Vector3(0, 0, -1),
  ]);
  const rayMaterial = new LineBasicMaterial({ color: 0xffffff });
  const gripGeometry = new SphereGeometry(0.02, 16, 12);
  const gripMaterial = new MeshBasicMaterial({ color: 0xb05ffe });
  const controllerObjects: Group[] = [];
  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.add(new Line(rayGeometry, rayMaterial));
    const grip = renderer.xr.getControllerGrip(i);
    grip.add(new Mesh(gripGeometry, gripMaterial));
    scene.add(controller, grip);
    controllerObjects.push(controller, grip);
  }

  // Seed joint targets from the robot's current pose.
  const robotJoints =
    (viewer.robot as unknown as { joints?: Record<string, { angle: number }> })
      ?.joints ?? {};
  const jointTargets: Record<string, number> = {};
  for (const name of JOINT_NAMES) {
    jointTargets[name] = clampToLimits(name, robotJoints[name]?.angle ?? 0);
  }
  const lastSent: Record<string, number> = { ...jointTargets };

  const setJointTarget = (name: string, value: number): boolean => {
    const clamped = clampToLimits(name, value);
    if (Math.abs(clamped - jointTargets[name]) < CHANGE_EPSILON) return false;
    jointTargets[name] = clamped;
    return true;
  };

  const adjustJointTarget = (name: string, delta: number): boolean => {
    if (delta === 0) return false;
    return setJointTarget(name, jointTargets[name] + delta);
  };

  // The Jaw mapping is absolute (trigger 0..1 -> closed..open), so an
  // untouched trigger reads 0 and would slam the jaw closed the moment the
  // session starts. Latch behind first intent: only apply the mapping once
  // the trigger has actually been pressed this session.
  let jawEngaged = false;

  // Grip-to-move end-effector state (right controller only).
  let eeGripActive = false;
  let eeOriginPosition: Vector3 | null = null;
  let eeOriginQuaternion: Quaternion | null = null;
  let lastEeSendTime = 0;

  const endEeGrip = () => {
    if (!eeGripActive) return;
    eeGripActive = false;
    eeOriginPosition = null;
    eeOriginQuaternion = null;
    // The echo drove the viewer while the grip was held; re-seed the stick
    // targets from the viewer's pose so joint control resumes without a jump.
    const joints =
      (viewer.robot as unknown as { joints?: Record<string, { angle: number }> })
        ?.joints ?? {};
    for (const name of JOINT_NAMES) {
      jointTargets[name] = clampToLimits(
        name,
        joints[name]?.angle ?? jointTargets[name]
      );
      lastSent[name] = jointTargets[name];
    }
    options.onEeGripChange?.(false);
  };

  // Returns whether grip-EE control is active this frame; sends ee_reset on
  // the grip press edge and ee_command (throttled to 20 Hz) while held.
  const pollGripEe = (time: number, frame: XRFrame): boolean => {
    const referenceSpace = renderer.xr.getReferenceSpace();
    if (!referenceSpace) return eeGripActive;
    let gripHeld = false;
    for (const source of session.inputSources) {
      if (source.handedness !== "right" || !source.gripSpace) continue;
      const gamepad = source.gamepad;
      if (!gamepad) continue;
      if ((gamepad.buttons[1]?.value ?? 0) <= GRIP_PRESS_THRESHOLD) continue;
      const pose = frame.getPose(source.gripSpace, referenceSpace);
      if (!pose) continue;
      const { position, orientation } = pose.transform;
      if (!eeGripActive) {
        // Press edge: re-anchor the backend at the arm's current pose and
        // snapshot the controller pose as the movement origin.
        if (!options.sendMessage({ type: "ee_reset" })) continue;
        eeOriginPosition = new Vector3(position.x, position.y, position.z);
        eeOriginQuaternion = new Quaternion(
          orientation.x,
          orientation.y,
          orientation.z,
          orientation.w
        );
        eeGripActive = true;
        lastEeSendTime = 0;
        options.onEeGripChange?.(true);
      }
      gripHeld = true;
      if (!eeOriginPosition || !eeOriginQuaternion) continue;
      if (time - lastEeSendTime < SEND_INTERVAL_MS) continue;
      const xrDelta = new Vector3(
        position.x - eeOriginPosition.x,
        position.y - eeOriginPosition.y,
        position.z - eeOriginPosition.z
      );
      const rotationDelta = relativeRotationVector(
        new Quaternion(orientation.x, orientation.y, orientation.z, orientation.w),
        eeOriginQuaternion
      );
      // Wrist signs mirror telegrip's ControlGoal (vr_ws_server.py:336-347):
      // wrist_roll = -extract_roll = +rotvec.z, wrist_pitch = -extract_pitch
      // = -rotvec.x.
      const sent = options.sendMessage({
        type: "ee_command",
        delta: xrDeltaToRobotFrame(xrDelta),
        wrist_pitch_delta: -rotationDelta.x,
        wrist_roll_delta: rotationDelta.z,
        gripper: gamepad.buttons[0]?.value ?? 0,
      });
      if (sent) lastEeSendTime = time;
    }
    if (!gripHeld) endEeGrip();
    return eeGripActive;
  };

  const pollControllers = (dt: number): string[] => {
    const changed: string[] = [];
    const track = (name: string, didChange: boolean) => {
      if (didChange) changed.push(name);
    };
    for (const source of session.inputSources) {
      const gamepad = source.gamepad;
      if (!gamepad) continue;
      const { x, y } = readStick(gamepad);
      const trigger = gamepad.buttons[0]?.value ?? 0;
      const grip = gamepad.buttons[1]?.value ?? 0;
      const step = STICK_RATE_RAD_PER_S * dt;

      if (source.handedness === "left") {
        track("Rotation", adjustJointTarget("Rotation", x * step));
        // Stick pushed forward reads negative Y; forward = pitch up.
        track("Pitch", adjustJointTarget("Pitch", -y * step));
        const wristDelta =
          (applyDeadzone(grip) - applyDeadzone(trigger)) * step;
        track("Wrist_Pitch", adjustJointTarget("Wrist_Pitch", wristDelta));
      } else if (source.handedness === "right") {
        track("Elbow", adjustJointTarget("Elbow", -y * step));
        track("Wrist_Roll", adjustJointTarget("Wrist_Roll", x * step));
        if (!jawEngaged && trigger > JAW_ENGAGE_THRESHOLD) jawEngaged = true;
        if (jawEngaged) {
          const [jawClosed, jawOpen] = JOINT_LIMITS.Jaw;
          track(
            "Jaw",
            setJointTarget("Jaw", jawClosed + trigger * (jawOpen - jawClosed))
          );
        }
      }
    }
    return changed;
  };

  let lastFrameTime = 0;
  let lastSendTime = 0;

  const onXrFrame = (time: number, frame?: XRFrame) => {
    const dt = lastFrameTime
      ? Math.min((time - lastFrameTime) / 1000, 0.1)
      : 0;
    lastFrameTime = time;

    const eeActive = frame ? pollGripEe(time, frame) : eeGripActive;

    if (dt > 0 && !eeActive) {
      // Optimistic local apply so the headset view never waits on the server.
      // Suspended while grip-EE is active: the backend IK owns the pose and
      // its joint_update echoes drive the viewer.
      for (const name of pollControllers(dt)) {
        viewer.setJointValue(name, jointTargets[name]);
      }
    }

    // Throttled to 20 Hz and only-when-changed.
    if (time - lastSendTime >= SEND_INTERVAL_MS) {
      const payload: Record<string, number> = {};
      for (const name of JOINT_NAMES) {
        if (Math.abs(jointTargets[name] - lastSent[name]) > CHANGE_EPSILON) {
          payload[name] = jointTargets[name];
        }
      }
      if (Object.keys(payload).length > 0 && options.sendJoints(payload)) {
        Object.assign(lastSent, payload);
        lastSendTime = time;
      }
    }

    // During a presenting session three renders through the XR camera.
    renderer.render(scene, camera);
  };

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    endEeGrip();
    renderer.setAnimationLoop(null);
    renderer.xr.enabled = false;
    for (const object of controllerObjects) {
      scene.remove(object);
    }
    rayGeometry.dispose();
    rayMaterial.dispose();
    gripGeometry.dispose();
    gripMaterial.dispose();
    scene.remove(xrExtras);
    viewer.world.position.copy(originalWorldPosition);
    viewer.updateSize = originalUpdateSize;
    viewer.redraw = originalRedraw;
    if (hadAutoRedraw) viewer.setAttribute("auto-redraw", "true");
    viewer.redraw();
  };

  session.addEventListener("end", cleanup);

  renderer.xr.enabled = true;
  try {
    await renderer.xr.setSession(session);
  } catch (err) {
    cleanup();
    session.end().catch(() => {});
    return { ok: false, error: `Could not bind renderer to XR session: ${err}` };
  }
  renderer.setAnimationLoop(onXrFrame);

  return {
    ok: true,
    session,
    end: () => {
      session.end().catch(() => {});
    },
  };
};
