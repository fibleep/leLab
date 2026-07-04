import React, { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Camera, RefreshCw, ShieldAlert, VideoOff } from "lucide-react";
import { useCameraStream } from "@/hooks/useCameraStream";

interface VideoInputDevice {
  deviceId: string;
  label: string;
}

type GridError =
  | "insecure-context"
  | "permission-denied"
  | "enumeration-failed"
  | null;

const GRID_ERROR_MESSAGES: Record<Exclude<GridError, null>, string> = {
  "insecure-context":
    "Camera access needs a secure context. Open leLab over https:// or http://localhost.",
  "permission-denied":
    "Camera permission denied. Allow camera access for this site in the browser, then refresh.",
  "enumeration-failed": "Could not list cameras. Refresh to try again.",
};

const TILE_ERROR_MESSAGES: Record<string, string> = {
  NotAllowedError: "Permission denied",
  NotReadableError: "Device busy — another app may be using this camera",
  AbortError: "Device busy — another app may be using this camera",
  NotFoundError: "Device disconnected — refresh the list",
  OverconstrainedError: "Device unavailable — refresh the list",
};

/**
 * Client-side live preview of every video input the browser can see, so a
 * shot can be framed before recording. Purely navigator.mediaDevices — no
 * backend involved, which is why the labels are browser names rather than
 * cv2 indices (see the caption rendered below the grid).
 */
const CameraPreviewGrid: React.FC = () => {
  const [devices, setDevices] = useState<VideoInputDevice[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [gridError, setGridError] = useState<GridError>(null);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    // Unmount all tiles first so their streams stop (track.stop() runs in
    // useCameraStream's cleanup) before we re-probe the devices.
    setDevices([]);
    setGridError(null);

    if (!window.isSecureContext || !navigator.mediaDevices?.enumerateDevices) {
      setGridError("insecure-context");
      setIsLoading(false);
      return;
    }

    // A granted getUserMedia call is required before enumerateDevices()
    // returns device labels (and, in Chrome, non-empty deviceIds).
    let permissionDenied = false;
    try {
      const probe = await navigator.mediaDevices.getUserMedia({ video: true });
      probe.getTracks().forEach((t) => t.stop());
    } catch (err) {
      const name = err instanceof DOMException ? err.name : "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        permissionDenied = true;
      }
      // NotFoundError and friends: fall through — enumeration still tells us
      // whether any device exists.
    }

    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const videoInputs = all
        .filter((d) => d.kind === "videoinput" && d.deviceId)
        .map((d, i) => ({
          deviceId: d.deviceId,
          label: d.label || `Camera ${i + 1}`,
        }));
      if (permissionDenied) setGridError("permission-denied");
      setDevices(videoInputs);
    } catch {
      setGridError("enumeration-failed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <span className="text-sm text-ink-2">
          {isLoading
            ? "Scanning for cameras…"
            : `${devices.length} camera${devices.length === 1 ? "" : "s"} found`}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => refresh()}
          disabled={isLoading}
          className="gap-1.5"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      {gridError && (
        <div className="flex items-start gap-3 rounded-panel border border-line bg-subtle p-4 text-sm text-warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{GRID_ERROR_MESSAGES[gridError]}</span>
        </div>
      )}

      {!isLoading && !gridError && devices.length === 0 && (
        <div className="py-10 text-center text-ink-3">
          <Camera className="mx-auto mb-4 h-12 w-12 text-ink-3" />
          <p>
            No cameras found. Connect a camera — for a phone, start Iriun on
            Mac and phone, then refresh.
          </p>
        </div>
      )}

      {devices.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {devices.map((device) => (
            <CameraPreviewTile key={device.deviceId} device={device} />
          ))}
        </div>
      )}

      <p className="text-xs text-ink-3">
        Camera names here match what <code>make find-cameras</code> reports;
        use that command for the exact index/resolution for recording configs.
      </p>
    </div>
  );
};

interface CameraPreviewTileProps {
  device: VideoInputDevice;
}

const CameraPreviewTile: React.FC<CameraPreviewTileProps> = ({ device }) => {
  const { videoRef, hasError, errorName } = useCameraStream(
    device.deviceId,
    false,
  );

  return (
    <div className="overflow-hidden rounded-panel border border-line bg-subtle">
      <div className="relative aspect-[4/3] bg-subtle">
        {hasError ? (
          <div className="flex h-full w-full flex-col items-center justify-center px-4 text-center">
            <VideoOff className="mb-2 h-8 w-8 text-ink-3" />
            <span className="text-sm text-ink-3">
              {TILE_ERROR_MESSAGES[errorName] ?? "Preview failed"}
            </span>
          </div>
        ) : (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="h-full w-full object-cover"
          />
        )}
      </div>
      <div className="p-3">
        <h5 className="truncate text-sm font-medium text-ink" title={device.label}>
          {device.label}
        </h5>
      </div>
    </div>
  );
};

interface CameraPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Shared entry point: the preview grid in a large dialog. Streams stop when
 * the dialog closes because Radix unmounts the content (and with it every
 * tile's useCameraStream cleanup). */
export const CameraPreviewDialog: React.FC<CameraPreviewDialogProps> = ({
  open,
  onOpenChange,
}) => (
  <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] overflow-y-auto border border-line bg-elevated p-6 sm:max-w-4xl">
      <DialogHeader>
        <DialogTitle className="font-mono text-sm uppercase tracking-[0.1em] text-ink">
          Camera Preview
        </DialogTitle>
        <DialogDescription className="text-ink-3">
          Live view of every camera the browser can see — frame your shot
          before recording.
        </DialogDescription>
      </DialogHeader>
      <CameraPreviewGrid />
    </DialogContent>
  </Dialog>
);

export default CameraPreviewGrid;
