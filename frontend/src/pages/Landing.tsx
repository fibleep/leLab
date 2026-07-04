import React, { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronsUpDown,
  Camera,
  Database,
  Play,
  Boxes,
  Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import TopNav from "@/components/nav/TopNav";
import Footer from "@/components/Footer";
import DotMatrixHeading from "@/components/brand/DotMatrixHeading";
import { Panel } from "@/components/brand/primitives";
import RobotConfigManager from "@/components/landing/RobotConfigManager";
import RecordingModal from "@/components/landing/RecordingModal";
import DatasetPicker from "@/components/landing/DatasetPicker";
import JobsSection from "@/components/jobs/JobsSection";

import UsageInstructionsModal from "@/components/landing/UsageInstructionsModal";
import { CameraPreviewDialog } from "@/components/CameraPreviewGrid";
import { useHfAuth } from "@/contexts/HfAuthContext";
import { useRobots } from "@/hooks/useRobots";
import { useDatasets } from "@/hooks/useDatasets";
import { DatasetItem } from "@/lib/replayApi";
import { CameraConfig } from "@/components/recording/CameraConfiguration";
import { isHostedSpace } from "@/lib/isHostedSpace";

const ON_SPACE = isHostedSpace();

const Landing = () => {
  const [showUsageModal, setShowUsageModal] = useState(ON_SPACE);
  const [showCameraPreview, setShowCameraPreview] = useState(false);
  const { auth } = useHfAuth();

  const {
    selectedName,
    selectedRecord,
    availableNames,
    isLoading: isLoadingRobots,
    selectRobot,
    createRobot,
    deleteRobot,
  } = useRobots();

  const { datasets, loading: datasetsLoading } = useDatasets();

  // Recording modal state
  const [showRecordingModal, setShowRecordingModal] = useState(false);
  const [datasetName, setDatasetName] = useState("");
  const [singleTask, setSingleTask] = useState("");
  const [numEpisodes, setNumEpisodes] = useState(5);
  const [episodeTimeS, setEpisodeTimeS] = useState(60);
  const [resetTimeS, setResetTimeS] = useState(15);
  const [streamingEncoding, setStreamingEncoding] = useState(true);
  const [cameras, setCameras] = useState<CameraConfig[]>([]);

  const releaseStreamsRef = useRef<(() => void) | null>(null);

  const navigate = useNavigate();
  const { toast } = useToast();

  // Clear camera state and release streams when returning to landing page
  useEffect(() => {
    if (cameras.length > 0) {
      console.log(
        "🧹 Landing page: Cleaning up camera state from previous session",
      );
      if (releaseStreamsRef.current) {
        releaseStreamsRef.current();
      }
      setCameras([]);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (releaseStreamsRef.current) {
        console.log("🧹 Landing page: Cleaning up camera streams on unmount");
        releaseStreamsRef.current();
      }
    };
  }, []);

  const openRecordingModal = () => {
    setCameras(selectedRecord ? [...(selectedRecord.cameras ?? [])] : []);
    setShowRecordingModal(true);
  };

  const handleRecordingModalClose = (open: boolean) => {
    setShowRecordingModal(open);
    if (!open && releaseStreamsRef.current) {
      console.log("🧹 Modal closed: Releasing camera streams");
      releaseStreamsRef.current();
    }
  };

  const handleTrainingClick = () => navigate("/training");

  const openHubViewer = (repoId: string, isPrivate: boolean) => {
    const spacePath = `/spaces/lerobot/visualize_dataset?path=${encodeURIComponent(`/${repoId}`)}`;
    const target = isPrivate
      ? `https://huggingface.co/login?next=${encodeURIComponent(spacePath)}`
      : `https://huggingface.co${spacePath}`;
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const handlePickExisting = (item: DatasetItem) => {
    if (item.source === "local" || item.source === "both") {
      navigate("/upload", {
        state: {
          datasetInfo: {
            dataset_repo_id: item.repo_id,
            source: item.source,
          },
        },
      });
      return;
    }
    openHubViewer(item.repo_id, item.private);
  };

  const handleOpenCustom = (repoId: string) => {
    // Custom-typed repo IDs are always treated as Hub paths. We don't know
    // privacy, so route through the login redirect to be safe.
    openHubViewer(repoId, true);
  };

  const handleCreateDataset = (name: string) => {
    setDatasetName(name);
    openRecordingModal();
  };

  const handleStartRecording = async () => {
    if (!selectedRecord) {
      toast({
        title: "No robot selected",
        description: "Select or create a robot on the Landing page first.",
        variant: "destructive",
      });
      return;
    }
    const robot = selectedRecord;
    if (!robot.is_clean) {
      toast({
        title: "Robot not ready",
        description: robot.is_follower_ready
          ? `${robot.name} needs a leader arm for teleoperation before it can record. SO101 leader and follower use the same servos — calibrate a second follower arm under the Leader flow in Calibration.`
          : `${robot.name} is missing a calibration. Configure it before recording.`,
        variant: "destructive",
      });
      return;
    }
    if (!datasetName || !singleTask) {
      toast({
        title: "Missing dataset details",
        description: "Please enter a dataset name and task description.",
        variant: "destructive",
      });
      return;
    }

    const datasetRepoId =
      auth.status === "authenticated"
        ? `${auth.username}/${datasetName}`
        : datasetName;

    if (cameras.length > 0 && releaseStreamsRef.current) {
      console.log("🔓 Releasing camera streams before starting recording...");
      toast({
        title: "Preparing Camera Resources",
        description: `Releasing ${cameras.length} camera stream(s) for recording...`,
      });
      releaseStreamsRef.current();
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log("✅ Camera streams released, proceeding with recording...");
      toast({
        title: "Camera Resources Ready",
        description:
          "Camera streams released successfully. Starting recording...",
      });
    }

    const cameraDict = cameras.reduce(
      (acc, cam) => {
        acc[cam.name] = {
          type: cam.type,
          camera_index: cam.camera_index,
          width: cam.width,
          height: cam.height,
          fps: cam.fps,
          ...(cam.fourcc ? { fourcc: cam.fourcc } : {}),
          ...(cam.backend ? { backend: cam.backend } : {}),
        };
        return acc;
      },
      {} as Record<
        string,
        {
          type: string;
          camera_index?: number;
          width: number;
          height: number;
          fps?: number;
          fourcc?: string;
          backend?: string;
        }
      >,
    );

    const recordingConfig = {
      leader_port: robot.leader_port,
      follower_port: robot.follower_port,
      leader_config: robot.leader_config,
      follower_config: robot.follower_config,
      dataset_repo_id: datasetRepoId,
      single_task: singleTask,
      num_episodes: numEpisodes,
      episode_time_s: episodeTimeS,
      reset_time_s: resetTimeS,
      fps: 30,
      video: true,
      push_to_hub: false,
      resume: false,
      streaming_encoding: streamingEncoding,
      cameras: cameraDict,
    };

    setShowRecordingModal(false);
    navigate("/recording", { state: { recordingConfig } });
  };

  const datasetLabel = selectedRecord?.name
    ? `Select or create a dataset…`
    : "Select or create a dataset…";

  return (
    <div className="min-h-screen bg-surface text-ink">
      <TopNav onRecord={openRecordingModal} onHelp={() => setShowUsageModal(true)} />

      {/* Hero — compact wordmark accent, not a billboard */}
      <header className="mx-auto flex max-w-[1400px] flex-wrap items-baseline justify-between gap-x-6 gap-y-2 px-6 pt-24 pb-6 md:px-8">
        <DotMatrixHeading className="text-[clamp(1.6rem,3.4vw,2.75rem)]">
          DATA BECOMES <span className="dm-amber">POLICY.</span>
        </DotMatrixHeading>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          Camera → policy → robot.
        </p>
      </header>

      {/* Unified workspace — one clean view of everything */}
      <main className="mx-auto grid max-w-[1400px] grid-cols-1 gap-4 px-6 pb-16 md:px-8 lg:grid-cols-2">
        {/* LEFT — robot / camera / dataset */}
        <div className="flex flex-col gap-4">
          <RobotConfigManager
            selectedName={selectedName}
            selectedRecord={selectedRecord}
            availableNames={availableNames}
            isLoading={isLoadingRobots}
            selectRobot={selectRobot}
            createRobot={createRobot}
            deleteRobot={deleteRobot}
          />

          <Panel title="Camera" meta="Ready">
            <button
              type="button"
              onClick={() => setShowCameraPreview(true)}
              className="flex h-28 w-full items-center justify-center gap-2 rounded-panel border border-dashed border-line bg-subtle text-ink-3 transition-colors hover:border-brand/50 hover:text-ink"
            >
              <Camera className="h-4 w-4" />
              <span className="font-mono text-[11px] uppercase tracking-kicker">
                Live preview · configure
              </span>
            </button>
          </Panel>

          <Panel title="Dataset">
            <DatasetPicker
              datasets={datasets}
              loading={datasetsLoading}
              onPickExisting={handlePickExisting}
              onOpenCustom={handleOpenCustom}
              onCreateNew={handleCreateDataset}
            >
              <Button
                variant="outline"
                role="combobox"
                className="w-full justify-between normal-case tracking-normal"
              >
                <span className="truncate text-ink-2">
                  {datasetsLoading ? "Loading datasets…" : datasetLabel}
                </span>
                <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
              </Button>
            </DatasetPicker>
          </Panel>
        </div>

        {/* RIGHT — quick actions + jobs */}
        <div className="flex flex-col gap-4">
          <Panel title="Workspace">
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={openRecordingModal}
                className="flex flex-col items-start gap-3 rounded-panel bg-brand p-4 text-surface transition-colors hover:bg-brand-muted active:opacity-70"
              >
                <Circle className="h-5 w-5 fill-current" />
                <span className="font-mono text-xs uppercase tracking-[0.1em]">
                  Record episode
                </span>
              </button>
              {[
                { icon: Play, label: "Train policy", onClick: handleTrainingClick },
                { icon: Boxes, label: "VR teleop", onClick: () => navigate("/vr") },
                { icon: Database, label: "Datasets", onClick: () => navigate("/upload") },
              ].map(({ icon: Icon, label, onClick }) => (
                <button
                  key={label}
                  type="button"
                  onClick={onClick}
                  className="flex flex-col items-start gap-3 rounded-panel border border-line bg-elevated p-4 text-ink-2 transition-colors hover:bg-subtle hover:text-ink active:opacity-70"
                >
                  <Icon className="h-5 w-5" />
                  <span className="font-mono text-xs uppercase tracking-[0.1em]">
                    {label}
                  </span>
                </button>
              ))}
            </div>
          </Panel>

          <Panel title="Jobs" bodyClassName="p-0">
            <JobsSection />
          </Panel>
        </div>
      </main>

      <Footer />

      <UsageInstructionsModal
        open={showUsageModal}
        onOpenChange={setShowUsageModal}
        dismissible={!ON_SPACE}
      />

      <CameraPreviewDialog
        open={showCameraPreview}
        onOpenChange={setShowCameraPreview}
      />

      <RecordingModal
        open={showRecordingModal}
        onOpenChange={handleRecordingModalClose}
        robot={selectedRecord}
        datasetName={datasetName}
        setDatasetName={setDatasetName}
        singleTask={singleTask}
        setSingleTask={setSingleTask}
        numEpisodes={numEpisodes}
        setNumEpisodes={setNumEpisodes}
        episodeTimeS={episodeTimeS}
        setEpisodeTimeS={setEpisodeTimeS}
        resetTimeS={resetTimeS}
        setResetTimeS={setResetTimeS}
        streamingEncoding={streamingEncoding}
        setStreamingEncoding={setStreamingEncoding}
        cameras={cameras}
        setCameras={setCameras}
        onStart={handleStartRecording}
        releaseStreamsRef={releaseStreamsRef}
      />
    </div>
  );
};

export default Landing;
