import React from "react";
import { VideoOff } from "lucide-react";
import { useCameraStream } from "@/hooks/useCameraStream";

interface CameraFeedProps {
  /** Browser deviceId to stream. Empty string renders the "no camera" state. */
  deviceId: string;
  /** Optional caption shown under the feed. */
  label?: string;
}

/** Live browser-camera feed bound to a deviceId via getUserMedia. */
const CameraFeed: React.FC<CameraFeedProps> = ({ deviceId, label }) => {
  const { videoRef, hasError } = useCameraStream(deviceId, false);
  const showVideo = deviceId && !hasError;

  return (
    <div className="bg-elevated rounded-panel border border-line overflow-hidden">
      <div className="aspect-[4/3] bg-subtle relative">
        {showVideo ? (
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center">
            <VideoOff className="w-8 h-8 text-ink-3 mb-2" />
            <span className="font-mono text-[11px] uppercase tracking-kicker text-ink-3">
              {deviceId ? "Preview failed" : "No camera selected"}
            </span>
          </div>
        )}
      </div>
      {label && (
        <div className="p-2 font-mono text-xs text-ink-2 truncate border-t border-line-soft">
          {label}
        </div>
      )}
    </div>
  );
};

export default CameraFeed;
