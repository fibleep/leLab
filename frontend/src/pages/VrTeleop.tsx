import React, { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Glasses } from "lucide-react";
import { Box3, Vector3 } from "three";
import URDFManipulator from "urdf-loader/src/urdf-manipulator-element.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/contexts/ApiContext";
import { useRobots } from "@/hooks/useRobots";
import { useRealTimeJoints } from "@/hooks/useRealTimeJoints";
import {
  createUrdfViewer,
  setupMeshLoader,
  setupModelLoading,
  defaultUrdfUrlModifier,
  DEFAULT_URDF_PATH,
  URDFViewerElement,
} from "@/lib/urdfViewerHelpers";
import {
  JOINT_LIMITS,
  JOINT_NAMES,
  clampToLimits,
  isVrSupported,
  startVrSession,
} from "@/lib/vrXr";

// Register the URDFManipulator as a custom element if it hasn't been already
if (typeof window !== "undefined" && !customElements.get("urdf-viewer")) {
  customElements.define("urdf-viewer", URDFManipulator);
}

interface VrBackendStatus {
  active: boolean;
  mode: string | null;
}

const initialJointValues = (): Record<string, number> =>
  Object.fromEntries(JOINT_NAMES.map((name) => [name, 0]));

const fitRobotToView = (viewer: URDFViewerElement) => {
  if (!viewer.robot) return;
  const boundingBox = new Box3().setFromObject(viewer.robot);
  const center = boundingBox.getCenter(new Vector3());
  const size = boundingBox.getSize(new Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  viewer.camera.position
    .copy(center)
    .add(new Vector3(1, 1, 1).normalize().multiplyScalar(maxDim * 1.3));
  viewer.controls.target.copy(center);
  viewer.controls.update();
  viewer.redraw();
};

const VrTeleop = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { selectedRecord } = useRobots();

  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<URDFViewerElement | null>(null);
  const xrEndRef = useRef<(() => void) | null>(null);
  // While in XR, ignore backend joint_update echoes so they don't fight the
  // optimistic local pose applied every XR frame.
  const suppressJointEchoRef = useRef(false);

  const [vrSupported, setVrSupported] = useState<boolean | null>(null);
  const [isInVr, setIsInVr] = useState(false);
  const [backendStatus, setBackendStatus] = useState<VrBackendStatus | null>(
    null
  );
  const [isSessionBusy, setIsSessionBusy] = useState(false);
  const [followerPort, setFollowerPort] = useState("");
  const [followerConfig, setFollowerConfig] = useState("");
  const [jointValues, setJointValues] = useState<Record<string, number>>(
    initialJointValues
  );

  const { isConnected, sendJointCommand, sendMessage } = useRealTimeJoints({
    viewerRef,
    enabled: true,
    suppressUpdatesRef: suppressJointEchoRef,
  });

  // Mount the URDF scene once.
  useEffect(() => {
    if (!containerRef.current) return;

    const viewer = createUrdfViewer(containerRef.current, true);
    viewerRef.current = viewer;
    setupMeshLoader(viewer, defaultUrdfUrlModifier);
    const cleanupModelLoading = setupModelLoading(
      viewer,
      DEFAULT_URDF_PATH,
      "/",
      () => {},
      []
    );

    const onModelProcessed = () => {
      fitRobotToView(viewer);
      const robotJoints =
        (
          viewer.robot as unknown as {
            joints?: Record<string, { angle: number }>;
          }
        )?.joints ?? {};
      setJointValues(
        Object.fromEntries(
          JOINT_NAMES.map((name) => [
            name,
            clampToLimits(name, robotJoints[name]?.angle ?? 0),
          ])
        )
      );
    };
    viewer.addEventListener("urdf-processed", onModelProcessed);

    return () => {
      viewer.removeEventListener("urdf-processed", onModelProcessed);
      cleanupModelLoading();
      if (xrEndRef.current) xrEndRef.current();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    isVrSupported().then(setVrSupported);
  }, []);

  // Prefill real-mode inputs from the selected robot config.
  useEffect(() => {
    if (!selectedRecord) return;
    setFollowerPort((prev) => prev || selectedRecord.follower_port);
    setFollowerConfig((prev) => prev || selectedRecord.follower_config);
  }, [selectedRecord]);

  const refreshBackendStatus = useCallback(async () => {
    try {
      const res = await fetchWithHeaders(`${baseUrl}/vr/session/status`);
      const data = await res.json();
      setBackendStatus({ active: !!data.active, mode: data.mode ?? null });
    } catch {
      setBackendStatus(null);
    }
  }, [baseUrl, fetchWithHeaders]);

  useEffect(() => {
    refreshBackendStatus();
    const intervalId = setInterval(refreshBackendStatus, 3000);
    return () => clearInterval(intervalId);
  }, [refreshBackendStatus]);

  const startBackendSession = async (mode: "virtual" | "real") => {
    if (mode === "real" && !followerPort) {
      toast({
        title: "Follower port required",
        description: "Enter the follower serial port to start a real session.",
        variant: "destructive",
      });
      return;
    }
    setIsSessionBusy(true);
    try {
      const body =
        mode === "virtual"
          ? { mode }
          : { mode, follower_port: followerPort, follower_config: followerConfig };
      const res = await fetchWithHeaders(`${baseUrl}/vr/session/start`, {
        method: "POST",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      toast({
        title: data.success
          ? `VR session started (${data.mode ?? mode})`
          : "Failed to start VR session",
        description: data.message,
        variant: data.success ? undefined : "destructive",
      });
    } catch (error) {
      toast({
        title: "Failed to start VR session",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setIsSessionBusy(false);
      refreshBackendStatus();
    }
  };

  const stopBackendSession = async () => {
    setIsSessionBusy(true);
    try {
      const res = await fetchWithHeaders(`${baseUrl}/vr/session/stop`, {
        method: "POST",
      });
      const data = await res.json();
      toast({
        title: data.success ? "VR session stopped" : "Failed to stop VR session",
        description: data.message,
        variant: data.success ? undefined : "destructive",
      });
    } catch (error) {
      toast({
        title: "Failed to stop VR session",
        description: String(error),
        variant: "destructive",
      });
    } finally {
      setIsSessionBusy(false);
      refreshBackendStatus();
    }
  };

  const handleEnterVr = async () => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const result = await startVrSession(viewer, {
      sendJoints: sendJointCommand,
      sendMessage,
      // While grip-EE control is active the backend's joint_update echo IS
      // the authoritative pose, so let it through; in stick mode suppress it
      // again so it doesn't fight the optimistic local joint state.
      onEeGripChange: (active) => {
        suppressJointEchoRef.current = !active;
      },
    });
    if (!result.ok) {
      toast({
        title: "Could not enter VR",
        description: result.error,
        variant: "destructive",
      });
      return;
    }
    xrEndRef.current = result.end;
    suppressJointEchoRef.current = true;
    setIsInVr(true);
    result.session.addEventListener("end", () => {
      xrEndRef.current = null;
      suppressJointEchoRef.current = false;
      setIsInVr(false);
    });
  };

  const handleExitVr = () => {
    if (xrEndRef.current) xrEndRef.current();
  };

  const handleSliderChange = (name: string, rawValue: number) => {
    const value = clampToLimits(name, rawValue);
    setJointValues((prev) => ({ ...prev, [name]: value }));
    viewerRef.current?.setJointValue(name, value);
    sendJointCommand({ [name]: value });
  };

  return (
    <div className="min-h-screen bg-black text-white p-2 sm:p-4">
      <div className="mx-auto max-w-7xl flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate("/")}
            className="bg-gray-800 border-gray-600 text-white hover:bg-gray-700"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <h1 className="text-xl font-semibold">VR Teleoperation</h1>
          <div
            className={`ml-auto flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-mono ${
              isConnected
                ? "bg-green-900/70 text-green-300"
                : "bg-red-900/70 text-red-300"
            }`}
          >
            <div
              className={`w-2 h-2 rounded-full ${
                isConnected ? "bg-green-400" : "bg-red-400"
              }`}
            />
            {isConnected ? "WebSocket connected" : "WebSocket disconnected"}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[2fr_1fr] gap-4">
          <div className="relative h-[50vh] lg:h-[75vh] rounded-lg overflow-hidden border border-gray-700 bg-gradient-to-br from-gray-900 to-gray-800">
            <div ref={containerRef} className="w-full h-full" />
            <div className="absolute bottom-4 left-4 z-10">
              {isInVr ? (
                <Button
                  onClick={handleExitVr}
                  className="bg-red-500 hover:bg-red-600 text-white"
                >
                  <Glasses className="mr-2 h-4 w-4" />
                  Exit VR
                </Button>
              ) : (
                <Button
                  onClick={handleEnterVr}
                  disabled={!vrSupported}
                  className="bg-blue-500 hover:bg-blue-600 text-white"
                >
                  <Glasses className="mr-2 h-4 w-4" />
                  {vrSupported === null
                    ? "Checking VR support…"
                    : vrSupported
                      ? "Enter VR"
                      : "VR not supported"}
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-4">
            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 flex flex-col gap-3">
              <h3 className="font-semibold text-lg">Backend session</h3>
              <p className="text-sm text-gray-400">
                Grip = move end-effector · Sticks = joints · Trigger = gripper
              </p>
              <div className="text-sm font-mono text-gray-300">
                {backendStatus === null
                  ? "Status: unavailable"
                  : backendStatus.active
                    ? `Status: active (${backendStatus.mode})`
                    : "Status: inactive"}
              </div>
              <Button
                onClick={() => startBackendSession("virtual")}
                disabled={isSessionBusy || backendStatus?.active}
                className="w-full bg-blue-500 hover:bg-blue-600 text-white"
              >
                Start virtual session
              </Button>
              <div className="flex flex-col gap-2">
                <label
                  className="text-sm text-gray-400"
                  htmlFor="vr-follower-port"
                >
                  Follower port
                </label>
                <Input
                  id="vr-follower-port"
                  value={followerPort}
                  onChange={(e) => setFollowerPort(e.target.value)}
                  placeholder="/dev/tty.usbmodem…"
                  className="bg-gray-900 border-gray-600 text-white"
                />
                <label
                  className="text-sm text-gray-400"
                  htmlFor="vr-follower-config"
                >
                  Follower config
                </label>
                <Input
                  id="vr-follower-config"
                  value={followerConfig}
                  onChange={(e) => setFollowerConfig(e.target.value)}
                  placeholder="Calibration config name…"
                  className="bg-gray-900 border-gray-600 text-white"
                />
                <Button
                  onClick={() => startBackendSession("real")}
                  disabled={isSessionBusy || backendStatus?.active}
                  className="w-full bg-green-500 hover:bg-green-600 text-white"
                >
                  Start real session
                </Button>
              </div>
              <Button
                onClick={stopBackendSession}
                disabled={isSessionBusy || backendStatus?.active === false}
                variant="outline"
                className="w-full bg-gray-800 border-gray-600 text-white hover:bg-gray-700"
              >
                Stop session
              </Button>
            </div>

            <div className="bg-gray-800 rounded-lg border border-gray-700 p-4 flex flex-col gap-3">
              <h3 className="font-semibold text-lg">Desktop joint control</h3>
              <p className="text-sm text-gray-400">
                Sends the same joint commands as the VR controllers.
              </p>
              {JOINT_NAMES.map((name) => {
                const [lower, upper] = JOINT_LIMITS[name];
                return (
                  <div key={name} className="flex flex-col gap-1">
                    <div className="flex justify-between text-sm">
                      <label htmlFor={`vr-joint-${name}`}>{name}</label>
                      <span className="font-mono text-gray-300">
                        {jointValues[name].toFixed(2)} rad
                      </span>
                    </div>
                    <input
                      id={`vr-joint-${name}`}
                      type="range"
                      min={lower}
                      max={upper}
                      step={0.01}
                      value={jointValues[name]}
                      onChange={(e) =>
                        handleSliderChange(name, Number(e.target.value))
                      }
                      className="w-full accent-blue-500"
                    />
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default VrTeleop;
