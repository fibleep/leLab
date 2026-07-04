import React, { useState } from "react";
import { Settings, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RobotArmMode, RobotRecord } from "@/hooks/useRobots";
import RobotSelector from "./RobotSelector";

interface RobotTileProps {
  robot: RobotRecord | null;
  selectedName: string | null;
  availableNames: string[];
  isLoading: boolean;
  onSelect: (name: string) => void;
  onCreateNew: (name: string, armMode: RobotArmMode) => Promise<boolean>;
  onConfigure: (name: string) => void;
  onTeleop: (robot: RobotRecord) => void;
  onDelete: (name: string) => void;
}

const RobotTile: React.FC<RobotTileProps> = ({
  robot,
  selectedName,
  availableNames,
  isLoading,
  onSelect,
  onCreateNew,
  onConfigure,
  onTeleop,
  onDelete,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const isSingleArm = robot?.arm_mode === "single";
  // Single-arm robots only need the follower side; pairs keep the three-state logic.
  const status = robot
    ? isSingleArm
      ? robot.is_follower_ready
        ? "Ready"
        : "Needs configuration"
      : robot.is_clean
      ? "Ready"
      : robot.is_follower_ready
      ? "Follower ready · VR & inference"
      : "Needs configuration"
    : null;
  const statusColor = robot
    ? isSingleArm
      ? robot.is_follower_ready
        ? "text-green-400"
        : "text-amber-400"
      : robot.is_clean
      ? "text-green-400"
      : robot.is_follower_ready
      ? "text-sky-400"
      : "text-amber-400"
    : "";
  const teleopDisabled = !robot || isSingleArm || !robot.is_clean;

  return (
    <div className="bg-gray-800 rounded-lg border border-gray-700 p-3 flex flex-col gap-2 relative">
      <div className="flex items-center gap-2">
        <div className="flex-1 min-w-0">
          <RobotSelector
            selectedName={selectedName}
            availableNames={availableNames}
            onSelect={onSelect}
            onCreateNew={onCreateNew}
            isLoading={isLoading}
          />
        </div>
        {status && (
          <p className={`text-xs truncate shrink-0 ${statusColor}`}>
            {status}
          </p>
        )}
        {robot && (
          <div className="flex items-center gap-1 shrink-0">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-gray-300 hover:text-white"
                  onClick={() => onConfigure(robot.name)}
                  aria-label="Configure"
                >
                  <Settings className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Configure (calibrate)</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                  onClick={() => setConfirmDelete(true)}
                  aria-label="Delete robot"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Delete robot config</TooltipContent>
            </Tooltip>
          </div>
        )}
      </div>

      {robot && (
        <Tooltip>
          <TooltipTrigger asChild>
            <div className="w-full">
              <Button
                onClick={() => onTeleop(robot)}
                disabled={teleopDisabled}
                className={`w-full ${
                  teleopDisabled
                    ? "bg-red-500/30 hover:bg-red-500/30 text-red-200 cursor-not-allowed"
                    : "bg-yellow-500 hover:bg-yellow-600 text-white"
                }`}
              >
                Teleoperation
              </Button>
            </div>
          </TooltipTrigger>
          {teleopDisabled && (
            <TooltipContent className="max-w-xs">
              {isSingleArm
                ? "Single-arm robots don't support leader-follower teleoperation — use VR or Inference instead."
                : robot?.is_follower_ready
                ? "Teleoperation needs a leader arm. SO101 leader and follower use the same servos — calibrate a second follower arm under the Leader flow in Calibration to use it as the leader."
                : "Configure the robot first."}
            </TooltipContent>
          )}
        </Tooltip>
      )}

      {robot && (
        <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
          <DialogContent className="bg-gray-900 border-gray-800 text-white">
            <DialogHeader>
              <DialogTitle>Delete robot config?</DialogTitle>
              <DialogDescription className="text-gray-400">
                This deletes the robot config file from disk. Calibration files
                are not removed. This cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="flex gap-2 justify-end">
              <Button
                variant="outline"
                className="border-gray-600 text-gray-300"
                onClick={() => setConfirmDelete(false)}
              >
                Cancel
              </Button>
              <Button
                className="bg-red-500 hover:bg-red-600 text-white"
                onClick={async () => {
                  setConfirmDelete(false);
                  await onDelete(robot.name);
                }}
              >
                Delete
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

export default RobotTile;
