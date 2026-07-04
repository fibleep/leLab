import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  ArrowLeft,
  Settings,
  Activity,
  CheckCircle,
  XCircle,
  AlertCircle,
  Loader2,
  Play,
  Square,
  Camera,
  ShieldQuestion,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import TopNav from "@/components/nav/TopNav";
import Footer from "@/components/Footer";
import { Panel, Kicker, StatusDot, StepRow } from "@/components/brand/primitives";
import PortDetectionButton from "@/components/ui/PortDetectionButton";
import PortDetectionModal from "@/components/ui/PortDetectionModal";
import { useApi } from "@/contexts/ApiContext";
import { isMotorRangeComplete } from "@/lib/calibrationTargets";
import CameraConfiguration, {
  CameraConfig,
} from "@/components/recording/CameraConfiguration";

const DISCONTINUITY_ERROR_PREFIX = "Motor discontinuity detected";

interface CalibrationStatus {
  calibration_active: boolean;
  status: string; // "idle", "connecting", "recording", "completed", "error", "stopping"
  device_type: string | null;
  error: string | null;
  message: string;
  step: number;
  total_steps: number;
  current_positions: Record<string, number> | null;
  recorded_ranges: Record<
    string,
    { min: number; max: number; current: number }
  > | null;
}

interface CalibrationRequest {
  device_type: string; // "robot" or "teleop"
  port: string;
  config_file: string;
  robot_name: string | null;
}

interface RobotRecord {
  name: string;
  leader_port: string;
  follower_port: string;
  leader_config: string;
  follower_config: string;
  cameras: CameraConfig[];
  arm_mode: "single" | "pair";
  is_clean: boolean;
}

const Calibration = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const robotName =
    (location.state as { robot_name?: string } | null)?.robot_name ?? null;
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();

  const consoleRef = useRef<HTMLDivElement>(null);
  const demoVideoRef = useRef<HTMLDivElement>(null);

  const [deviceType, setDeviceType] = useState<string>("teleop");
  const [port, setPort] = useState<string>("");
  const [robot, setRobot] = useState<RobotRecord | null>(null);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);
  // Off by default so merely opening the calibration page never grabs a camera.
  // The user explicitly starts a scan, which is when cameras are turned on,
  // enumerated, and the browser permission prompt is requested.
  const [camerasActive, setCamerasActive] = useState(false);
  const cameraSaveTimerRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRobot = useCallback(async (): Promise<RobotRecord | null> => {
    if (!robotName) return null;
    try {
      const res = await fetchWithHeaders(
        `${baseUrl}/robots/${encodeURIComponent(robotName)}`
      );
      if (!res.ok) return null;
      const data = await res.json();
      const r = (data.robot as RobotRecord | null) ?? null;
      setRobot(r);
      return r;
    } catch (e) {
      console.error("Failed to load robot record:", e);
      return null;
    }
  }, [robotName, baseUrl, fetchWithHeaders]);

  // Initial fetch + form prefill on arrival.
  useEffect(() => {
    if (!robotName) return;
    let cancelled = false;
    (async () => {
      const r = await fetchRobot();
      if (!r || cancelled) return;
      // Default to the first incomplete side in the checklist (leader, then follower).
      // Single-arm robots have no leader — always start on the follower.
      const defaultDevice =
        r.arm_mode === "single"
          ? "robot"
          : !r.leader_config
          ? "teleop"
          : !r.follower_config
          ? "robot"
          : "teleop";
      setDeviceType(defaultDevice);
      setPort(
        defaultDevice === "teleop"
          ? r.leader_port || ""
          : r.follower_port || ""
      );
      setCameras(r.cameras ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [robotName, fetchRobot]);

  // Persist camera changes back to the robot record (debounced).
  const handleCamerasChange = (next: CameraConfig[]) => {
    setCameras(next);
    if (!robotName) return;
    if (cameraSaveTimerRef.current) {
      clearTimeout(cameraSaveTimerRef.current);
    }
    cameraSaveTimerRef.current = setTimeout(async () => {
      try {
        await fetchWithHeaders(
          `${baseUrl}/robots/${encodeURIComponent(robotName)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ cameras: next }),
          }
        );
      } catch (e) {
        console.error("Failed to save cameras to robot record:", e);
      }
    }, 500);
  };

  useEffect(() => {
    return () => {
      if (cameraSaveTimerRef.current) {
        clearTimeout(cameraSaveTimerRef.current);
      }
    };
  }, []);

  const [showPortDetection, setShowPortDetection] = useState(false);
  const [detectionRobotType, setDetectionRobotType] = useState<
    "leader" | "follower"
  >("leader");

  const [calibrationStatus, setCalibrationStatus] = useState<CalibrationStatus>(
    {
      calibration_active: false,
      status: "idle",
      device_type: null,
      error: null,
      message: "",
      step: 0,
      total_steps: 1,
      current_positions: null,
      recorded_ranges: null,
    }
  );
  const [isPolling, setIsPolling] = useState(false);

  // Mirror calibration_active into a ref so the unmount cleanup below can read
  // the latest value without re-firing on every status change.
  const calibrationActiveRef = useRef(false);
  useEffect(() => {
    calibrationActiveRef.current = calibrationStatus.calibration_active;
  }, [calibrationStatus.calibration_active]);

  // If the user leaves this page (back arrow, browser back, programmatic nav)
  // while calibration is running, the backend singleton stays active and the
  // next Start request fails with "Calibration already active". Stop it on
  // unmount as a catch-all.
  useEffect(() => {
    return () => {
      if (calibrationActiveRef.current) {
        fetchWithHeaders(`${baseUrl}/stop-calibration`, { method: "POST" }).catch(
          (e) => console.error("Failed to stop calibration on unmount:", e)
        );
      }
    };
  }, [baseUrl, fetchWithHeaders]);

  const pollStatus = async () => {
    try {
      const response = await fetchWithHeaders(`${baseUrl}/calibration-status`);
      if (response.ok) {
        const status = await response.json();
        setCalibrationStatus(status);

        if (
          !status.calibration_active &&
          (status.status === "completed" ||
            status.status === "error" ||
            status.status === "idle")
        ) {
          setIsPolling(false);
        }
      }
    } catch (error) {
      console.error("Error polling status:", error);
    }
  };

  const handleStartCalibration = async () => {
    if (!robotName) {
      toast({
        title: "No robot selected",
        description: "Open Calibration from a robot's gear icon on the Landing page.",
        variant: "destructive",
      });
      return;
    }
    if (!port) {
      toast({
        title: "Missing port",
        description: "Set the device's serial port before starting.",
        variant: "destructive",
      });
      return;
    }

    const request: CalibrationRequest = {
      device_type: deviceType,
      port: port,
      config_file: robotName,
      robot_name: robotName,
    };

    // Optimistically mark as active so the unmount cleanup will fire even if
    // the user navigates away before the backend reports calibration_active=true.
    // Reverted below if the start request fails.
    calibrationActiveRef.current = true;

    try {
      const response = await fetchWithHeaders(`${baseUrl}/start-calibration`, {
        method: "POST",
        body: JSON.stringify(request),
      });

      const result = await response.json();

      if (result.success) {
        toast({
          title: "Calibration Started",
          description: `Calibration started for ${deviceType}`,
        });
        setIsPolling(true);
      } else {
        calibrationActiveRef.current = false;
        toast({
          title: "Calibration Failed",
          description: result.message || "Failed to start calibration",
          variant: "destructive",
        });
      }
    } catch (error) {
      calibrationActiveRef.current = false;
      console.error("Error starting calibration:", error);
      toast({
        title: "Error",
        description: "Failed to start calibration",
        variant: "destructive",
      });
    }
  };

  const handleStopCalibration = async () => {
    try {
      const response = await fetchWithHeaders(`${baseUrl}/stop-calibration`, {
        method: "POST",
      });

      const result = await response.json();

      if (result.success) {
        // The 200ms polling interval will pick up the stopped state.
        toast({
          title: "Calibration Stopped",
          description: "Calibration has been stopped",
        });
      } else {
        toast({
          title: "Error",
          description: result.message || "Failed to stop calibration",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error stopping calibration:", error);
      toast({
        title: "Error",
        description: "Failed to stop calibration",
        variant: "destructive",
      });
    }
  };

  const handleCompleteStep = async () => {
    if (!calibrationStatus.calibration_active) return;

    try {
      const response = await fetchWithHeaders(
        `${baseUrl}/complete-calibration-step`,
        { method: "POST" }
      );

      const data = await response.json();

      if (data.success) {
        toast({
          title: "Step Completed",
          description: data.message,
        });
      } else {
        toast({
          title: "Step Failed",
          description: data.message || "Could not complete step",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error completing step:", error);
      toast({
        title: "Error",
        description: "Could not complete calibration step",
        variant: "destructive",
      });
    }
  };

  useEffect(() => {
    if (
      calibrationStatus.status === "error" &&
      calibrationStatus.error?.startsWith(DISCONTINUITY_ERROR_PREFIX)
    ) {
      demoVideoRef.current?.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [calibrationStatus.status, calibrationStatus.error]);

  useEffect(() => {
    if (!isPolling) return;
    // Single stable interval. Reads calibration_active from the ref each tick so
    // the interval doesn't tear down/recreate on every status change.
    pollStatus();
    const interval = setInterval(() => {
      pollStatus();
    }, 200);
    return () => clearInterval(interval);
    // pollStatus is stable enough — it only reads via fetchWithHeaders + setState.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPolling]);

  // Load default port when device type changes (skip when arriving from a tile —
  // the robot-record prefill above wins)
  useEffect(() => {
    const loadDefaultPort = async () => {
      if (!deviceType) return;
      if (robotName) return;

      try {
        const robotType = deviceType === "robot" ? "follower" : "leader";
        const response = await fetchWithHeaders(
          `${baseUrl}/robot-port/${robotType}`
        );
        const data = await response.json();
        if (data.status === "success") {
          const portToUse = data.saved_port || data.default_port;
          if (portToUse) {
            setPort(portToUse);
          }
        }
      } catch (error) {
        console.error("Error loading default port:", error);
      }
    };

    loadDefaultPort();
  }, [deviceType, robotName, baseUrl, fetchWithHeaders]);

  const handleDeviceTypeChange = (next: string) => {
    setDeviceType(next);
    if (!robot) return;
    setPort(
      next === "teleop" ? robot.leader_port || "" : robot.follower_port || ""
    );
  };

  // Refresh the robot record when a calibration completes so the checklist
  // flips to ✓ for the side that was just saved, and advance Device Type to
  // the next still-incomplete side (or stay on the current side if both done).
  useEffect(() => {
    if (calibrationStatus.status !== "completed") return;
    (async () => {
      const r = await fetchRobot();
      if (!r) return;
      const nextDevice =
        r.arm_mode === "single"
          ? "robot"
          : !r.leader_config
          ? "teleop"
          : !r.follower_config
          ? "robot"
          : "teleop";
      setDeviceType(nextDevice);
      setPort(
        nextDevice === "teleop"
          ? r.leader_port || ""
          : r.follower_port || ""
      );
    })();
  }, [calibrationStatus.status, fetchRobot]);

  const handlePortDetection = () => {
    const robotType = deviceType === "robot" ? "follower" : "leader";
    setDetectionRobotType(robotType);
    setShowPortDetection(true);
  };

  // Write the port for the current side straight into the robot record, so a
  // re-detected USB port (which shuffles on reboot/reconnect) sticks without
  // needing a full re-calibration. Mirrors the camera write-back above.
  const persistPort = useCallback(
    async (nextPort: string) => {
      if (!robotName || !nextPort) return;
      const field = deviceType === "robot" ? "follower_port" : "leader_port";
      // Skip redundant writes when the value already matches the record.
      if (robot && robot[field] === nextPort) return;
      try {
        const res = await fetchWithHeaders(
          `${baseUrl}/robots/${encodeURIComponent(robotName)}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ [field]: nextPort }),
          }
        );
        const data = await res.json();
        if (data.robot) setRobot(data.robot);
      } catch (e) {
        console.error("Failed to save port to robot record:", e);
      }
    },
    [robotName, deviceType, robot, baseUrl, fetchWithHeaders]
  );

  const handlePortDetected = (detectedPort: string) => {
    setPort(detectedPort);
    persistPort(detectedPort);
  };

  const getStatusDisplay = () => {
    switch (calibrationStatus.status) {
      case "idle":
        return {
          tone: "text-ink-3",
          icon: <Settings className="h-4 w-4" />,
          text: "Idle",
        };
      case "connecting":
        return {
          tone: "text-warning",
          icon: <Loader2 className="h-4 w-4 animate-spin" />,
          text: "Connecting",
        };
      case "recording":
        return {
          tone: "text-brand",
          icon: <Activity className="h-4 w-4" />,
          text: "Recording Ranges",
        };
      case "completed":
        return {
          tone: "text-success",
          icon: <CheckCircle className="h-4 w-4" />,
          text: "Completed",
        };
      case "error":
        return {
          tone: "text-error",
          icon: <XCircle className="h-4 w-4" />,
          text: "Error",
        };
      case "stopping":
        return {
          tone: "text-warning",
          icon: <Square className="h-4 w-4" />,
          text: "Stopping",
        };
      default:
        return {
          tone: "text-ink-3",
          icon: <Settings className="h-4 w-4" />,
          text: "Unknown",
        };
    }
  };

  const statusDisplay = getStatusDisplay();

  return (
    <div className="min-h-[100dvh] bg-surface text-ink">
      <TopNav />

      <main className="mx-auto max-w-[1400px] px-6 pb-16 pt-28 md:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Kicker>Calibration</Kicker>
            <h1 className="mt-2 font-mono text-2xl font-bold uppercase tracking-tight text-ink md:text-3xl">
              {robotName ? `Calibrate "${robotName}"` : "Device Calibration"}
            </h1>
          </div>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
            Back
          </Button>
        </div>

        {!robotName && (
          <div className="mt-6 flex items-start gap-3 rounded-panel border border-line bg-subtle px-4 py-4">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-warning" />
            <p className="font-sans text-sm leading-relaxed text-ink-2">
              Open Calibration from a robot's gear icon on the Landing page. Each
              robot has its own calibration; running this page directly is not
              supported.
            </p>
          </div>
        )}

        <div className="mt-8 grid grid-cols-1 gap-5 lg:grid-cols-2">
          {/* LEFT — configuration + steps */}
          <div className="flex flex-col gap-5">
            <Panel title="Configuration">
              <div className="space-y-6">
                <div className="space-y-2">
                  <Label
                    htmlFor="deviceType"
                    className="font-mono text-[11px] uppercase tracking-kicker text-ink-2"
                  >
                    Device type *
                  </Label>
                  <Select
                    value={deviceType}
                    onValueChange={handleDeviceTypeChange}
                  >
                    <SelectTrigger className="bg-subtle">
                      <SelectValue placeholder="Select device type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="teleop">
                        Teleoperator (Leader)
                      </SelectItem>
                      <SelectItem value="robot">Robot (Follower)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label
                    htmlFor="port"
                    className="font-mono text-[11px] uppercase tracking-kicker text-ink-2"
                  >
                    Port *
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      id="port"
                      value={port}
                      onChange={(e) => setPort(e.target.value)}
                      onBlur={(e) => persistPort(e.target.value)}
                      placeholder="/dev/tty.usbmodem…"
                      className="flex-1 bg-subtle font-mono"
                    />
                    <PortDetectionButton
                      onClick={handlePortDetection}
                      robotType={deviceType === "robot" ? "follower" : "leader"}
                    />
                  </div>
                </div>

                <div className="border-t border-line-soft pt-2">
                  {!calibrationStatus.calibration_active ? (
                    <Button
                      onClick={handleStartCalibration}
                      size="lg"
                      className="w-full rounded-full"
                      disabled={!robotName || !deviceType || !port}
                    >
                      <Play className="h-4 w-4" />
                      Start Calibration
                    </Button>
                  ) : (
                    <Button
                      onClick={handleStopCalibration}
                      variant="destructive"
                      size="lg"
                      className="w-full rounded-full"
                    >
                      <Square className="h-4 w-4" />
                      Cancel Calibration
                    </Button>
                  )}
                </div>
              </div>
            </Panel>

            {robot && (
              <Panel title="Calibration steps" bodyClassName="py-1">
                <StepRow
                  index={1}
                  active={
                    robot.arm_mode !== "single" && deviceType === "teleop"
                  }
                  title={
                    robot.arm_mode === "single"
                      ? "Leader — Not used"
                      : "Leader (Teleoperator)"
                  }
                  description={
                    robot.arm_mode === "single"
                      ? "Single-arm robot — no leader required."
                      : robot.leader_config
                      ? "Calibrated."
                      : "Not calibrated yet."
                  }
                  action={
                    robot.arm_mode === "single" ? (
                      <StatusDot status="muted" label="N/A" />
                    ) : robot.leader_config ? (
                      <StatusDot status="success" label="Done" />
                    ) : (
                      <StatusDot status="muted" label="Pending" />
                    )
                  }
                />
                <StepRow
                  index={2}
                  last
                  active={deviceType === "robot"}
                  title="Follower (Robot)"
                  description={
                    robot.follower_config
                      ? "Calibrated."
                      : "Not calibrated yet."
                  }
                  action={
                    robot.follower_config ? (
                      <StatusDot status="success" label="Done" />
                    ) : (
                      <StatusDot status="muted" label="Pending" />
                    )
                  }
                />
              </Panel>
            )}
          </div>

          {/* RIGHT — status */}
          <Panel title="Status">
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-panel border border-line bg-subtle px-3 py-2.5">
                <span className="font-mono text-[11px] uppercase tracking-kicker text-ink-3">
                  Status
                </span>
                <span
                  className={cn(
                    "inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-kicker",
                    statusDisplay.tone
                  )}
                >
                  {statusDisplay.icon}
                  {statusDisplay.text}
                </span>
              </div>

              {calibrationStatus.status === "recording" &&
                calibrationStatus.recorded_ranges && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Activity className="h-4 w-4 text-brand" />
                      <span className="font-mono text-[11px] uppercase tracking-kicker text-ink-2">
                        Live position data
                      </span>
                    </div>
                    <div className="rounded-panel border border-line bg-elevated p-4">
                      <div className="space-y-3">
                        {Object.entries(calibrationStatus.recorded_ranges).map(
                          ([motor, range]) => {
                            const totalRange = range.max - range.min;
                            const currentOffset = range.current - range.min;
                            const progressPercent =
                              totalRange > 0
                                ? (currentOffset / totalRange) * 100
                                : 50;
                            const rangeComplete = isMotorRangeComplete(
                              calibrationStatus.device_type,
                              motor,
                              totalRange
                            );

                            return (
                              <div key={motor} className="space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono text-sm font-bold text-ink">
                                      {motor}
                                    </span>
                                    {rangeComplete && (
                                      <CheckCircle
                                        className="h-4 w-4 text-success"
                                        aria-label="Range complete"
                                      />
                                    )}
                                  </div>
                                  <span className="font-mono text-xs tabular-nums text-ink-2">
                                    {range.current}
                                  </span>
                                </div>
                                <div className="relative">
                                  <div className="h-2.5 w-full rounded-full bg-subtle">
                                    <div className="relative h-2.5 w-full rounded-full">
                                      <div
                                        className={cn(
                                          "absolute top-0 h-2.5 w-1 -translate-x-1/2 rounded-full transition-all duration-100",
                                          rangeComplete
                                            ? "bg-success"
                                            : "bg-brand"
                                        )}
                                        style={{
                                          left: `${Math.max(
                                            0,
                                            Math.min(100, progressPercent)
                                          )}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                  <div className="mt-1 flex justify-between font-mono text-[11px] tabular-nums text-ink-3">
                                    <span>{range.min}</span>
                                    <span>{range.max}</span>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                        )}
                      </div>
                    </div>
                  </div>
                )}

              {calibrationStatus.status === "connecting" && (
                <div className="flex items-start gap-3 rounded-panel border border-line bg-subtle px-4 py-3">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <p className="font-sans text-sm text-ink-2">
                    Connecting to the device. Please ensure it's connected.
                  </p>
                </div>
              )}

              {calibrationStatus.status === "recording" && (() => {
                const ranges = calibrationStatus.recorded_ranges ?? {};
                const motors = Object.entries(ranges);
                const allComplete =
                  motors.length > 0 &&
                  motors.every(([motor, range]) =>
                    isMotorRangeComplete(
                      calibrationStatus.device_type,
                      motor,
                      range.max - range.min
                    )
                  );
                return (
                  <div className="space-y-3">
                    <Button
                      onClick={handleCompleteStep}
                      disabled={!calibrationStatus.calibration_active}
                      size="lg"
                      className="w-full rounded-full"
                    >
                      {allComplete ? (
                        <CheckCircle className="h-4 w-4" />
                      ) : (
                        <AlertCircle className="h-4 w-4" />
                      )}
                      Save Calibration
                    </Button>
                    <div className="flex items-start gap-3 rounded-panel border border-line bg-subtle px-4 py-3">
                      <Activity className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                      <p className="font-sans text-sm text-ink-2">
                        <strong className="font-medium text-ink">
                          Important:
                        </strong>{" "}
                        Move EACH joint through its full range. A check appears
                        next to each joint once its range is wide enough.
                      </p>
                    </div>
                  </div>
                );
              })()}

              {calibrationStatus.status === "completed" && (
                <div className="flex items-start gap-3 rounded-panel border border-line bg-subtle px-4 py-3">
                  <CheckCircle className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  <p className="font-sans text-sm text-ink-2">
                    Calibration completed successfully.
                  </p>
                </div>
              )}

              {calibrationStatus.status === "error" &&
                calibrationStatus.error &&
                (calibrationStatus.error.startsWith(
                  DISCONTINUITY_ERROR_PREFIX
                ) ? (
                  <div className="flex items-start gap-3 rounded-panel border border-error px-4 py-3">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
                    <div>
                      <div className="mb-1 font-sans text-sm font-medium text-ink">
                        Motor discontinuity detected
                      </div>
                      <p className="font-sans text-sm leading-relaxed text-ink-2">
                        Make sure to start the calibration with the robot in a
                        middle position — all joints in the middle of their
                        ranges. See the calibration demo below for the correct
                        starting pose.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-start gap-3 rounded-panel border border-error px-4 py-3">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-error" />
                    <p className="font-sans text-sm text-ink-2">
                      <strong className="font-medium text-ink">Error:</strong>{" "}
                      {calibrationStatus.error}
                    </p>
                  </div>
                ))}

              <div ref={demoVideoRef}>
                <Kicker>Calibration demo</Kicker>
                <div className="mt-3 overflow-hidden rounded-panel border border-line bg-subtle">
                  <video className="h-auto w-full" controls preload="auto" muted>
                    <source
                      src="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/lerobot/calibrate_so101_2.mp4"
                      type="video/mp4"
                    />
                    <p className="py-4 text-center font-sans text-sm text-ink-3">
                      Your browser does not support the video tag.
                      <br />
                      <a
                        href="https://huggingface.co/datasets/huggingface/documentation-images/resolve/main/lerobot/calibrate_so101_2.mp4"
                        className="text-brand underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Click here to view the calibration video
                      </a>
                    </p>
                  </video>
                </div>
              </div>
            </div>
          </Panel>
        </div>

        {robotName && (
          <Panel
            className="mt-5"
            title="Attached cameras"
            meta={
              <span className="flex items-center gap-2">
                <Label
                  htmlFor="cameras-toggle"
                  className="cursor-pointer font-mono text-[11px] uppercase tracking-kicker text-ink-3"
                >
                  {camerasActive ? "On" : "Off"}
                </Label>
                <Switch
                  id="cameras-toggle"
                  checked={camerasActive}
                  onCheckedChange={setCamerasActive}
                  className="data-[state=checked]:bg-brand"
                  aria-label="Turn cameras on or off"
                />
              </span>
            }
          >
            {camerasActive ? (
              <CameraConfiguration
                cameras={cameras}
                onCamerasChange={handleCamerasChange}
              />
            ) : (
              <div className="space-y-3 rounded-panel border border-dashed border-line bg-subtle p-6 text-center">
                <Camera className="mx-auto h-10 w-10 text-ink-3" />
                <div className="space-y-1">
                  <p className="font-sans text-sm font-medium text-ink">
                    Cameras are off
                  </p>
                  <p className="mx-auto max-w-md font-sans text-[13px] leading-relaxed text-ink-2">
                    Turn cameras on to scan for connected devices and preview
                    them. The browser may briefly open a camera to read device
                    labels, and configured cameras stay active while previews
                    are visible; your browser will ask for camera permission.
                    Nothing is recorded.
                  </p>
                  {cameras.length > 0 && (
                    <p className="pt-1 font-mono text-[11px] uppercase tracking-kicker text-ink-3">
                      {cameras.length} camera
                      {cameras.length === 1 ? "" : "s"} saved to this robot.
                    </p>
                  )}
                </div>
                <p className="flex items-center justify-center gap-1.5 font-sans text-[13px] text-ink-3">
                  <ShieldQuestion className="h-3.5 w-3.5" />
                  You'll be asked to grant camera access.
                </p>
              </div>
            )}
          </Panel>
        )}
      </main>

      <Footer />

      <PortDetectionModal
        open={showPortDetection}
        onOpenChange={setShowPortDetection}
        robotType={detectionRobotType}
        onPortDetected={handlePortDetected}
      />
    </div>
  );
};

export default Calibration;
