import React, { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ArrowLeft,
  Upload as UploadIcon,
  Database,
  Eye,
  EyeOff,
  ExternalLink,
  CheckCircle,
  AlertCircle,
  Loader2,
  Trash2,
} from "lucide-react";
import { useApi } from "@/contexts/ApiContext";
import { DatasetSource } from "@/lib/replayApi";
import TopNav from "@/components/nav/TopNav";
import Footer from "@/components/Footer";
import { Panel, Kicker, StatusDot } from "@/components/brand/primitives";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface DatasetInfo {
  dataset_repo_id: string;
  single_task: string;
  num_episodes: number;
  saved_episodes?: number;
  session_elapsed_seconds?: number;
  fps?: number;
  total_frames?: number;
  robot_type?: string;
  source?: DatasetSource;
}

interface UploadConfig {
  tags: string[];
  private: boolean;
}

const Upload = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();

  // Get initial dataset info from navigation state
  const initialDatasetInfo = location.state?.datasetInfo as DatasetInfo;

  // State for actual dataset info (will be loaded from backend)
  const [datasetInfo, setDatasetInfo] = useState<DatasetInfo | null>(null);
  const [isLoadingDatasetInfo, setIsLoadingDatasetInfo] = useState(true);

  // Upload configuration state
  const [uploadConfig, setUploadConfig] = useState<UploadConfig>({
    tags: ["robotics", "lerobot"],
    private: false,
  });

  const [tagsInput, setTagsInput] = useState(uploadConfig.tags.join(", "));
  const [isUploading, setIsUploading] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Load actual dataset information from backend
  React.useEffect(() => {
    const loadDatasetInfo = async () => {
      if (!initialDatasetInfo?.dataset_repo_id) {
        toast({
          title: "No Dataset Information",
          description: "Please complete a recording session first.",
          variant: "destructive",
        });
        navigate("/");
        return;
      }

      try {
        const response = await fetchWithHeaders(`${baseUrl}/dataset-info`, {
          method: "POST",
          body: JSON.stringify({
            dataset_repo_id: initialDatasetInfo.dataset_repo_id,
          }),
        });

        const data = await response.json();

        if (response.ok && data.success) {
          // Merge the loaded dataset info with any session info we have
          setDatasetInfo({
            ...data,
            saved_episodes: data.num_episodes, // Use actual episodes from dataset
            session_elapsed_seconds:
              initialDatasetInfo.session_elapsed_seconds || 0,
            source: initialDatasetInfo.source,
          });
        } else {
          // Fallback to initial dataset info if backend fails
          toast({
            title: "Warning",
            description:
              "Could not load complete dataset information. Using session data.",
            variant: "destructive",
          });
          setDatasetInfo(initialDatasetInfo);
        }
      } catch (error) {
        console.error("Error loading dataset info:", error);
        // Fallback to initial dataset info
        toast({
          title: "Warning",
          description: "Could not connect to backend. Using session data.",
          variant: "destructive",
        });
        setDatasetInfo(initialDatasetInfo);
      } finally {
        setIsLoadingDatasetInfo(false);
      }
    };

    loadDatasetInfo();
  }, [initialDatasetInfo, navigate, toast]);

  const openInHubViewer = (repoId: string) => {
    const spacePath = `/spaces/lerobot/visualize_dataset?path=${encodeURIComponent(`/${repoId}`)}`;
    // The user owns/manages the dataset (it appears under their hub
    // listing), so login-redirect always works whether public or
    // private. Avoids passing `private` through navigation state.
    const target = `https://huggingface.co/login?next=${encodeURIComponent(spacePath)}`;
    window.open(target, "_blank", "noopener,noreferrer");
  };

  const formatDuration = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${minutes}m ${secs}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  };

  const handleUploadToHub = async () => {
    if (!datasetInfo) return;

    setIsUploading(true);
    try {
      // Parse tags from input
      const tags = tagsInput
        .split(",")
        .map((tag) => tag.trim())
        .filter((tag) => tag.length > 0);

      const response = await fetchWithHeaders(`${baseUrl}/upload-dataset`, {
        method: "POST",
        body: JSON.stringify({
          dataset_repo_id: datasetInfo.dataset_repo_id,
          tags,
          private: uploadConfig.private,
        }),
      });

      const data = await response.json();

      if (response.ok && data.success) {
        setUploadSuccess(true);
        toast({
          title: "Upload Successful!",
          description: `Dataset ${datasetInfo.dataset_repo_id} has been uploaded to HuggingFace Hub.`,
        });
      } else {
        const fallback = "Failed to upload dataset to HuggingFace Hub.";
        toast({
          title: "Upload Failed",
          description: data.docs_url ? (
            <span>
              {data.message || fallback}{" "}
              <a
                href={data.docs_url}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-medium"
              >
                Open setup guide
              </a>
            </span>
          ) : (
            data.message || fallback
          ),
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Error uploading dataset:", error);
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleSkipUpload = () => {
    toast({
      title: "Upload Skipped",
      description: "Dataset saved locally. You can upload it manually later.",
    });
    navigate("/");
  };

  const handleDeleteDataset = async () => {
    if (!datasetInfo) return;
    setIsDeleting(true);
    try {
      const response = await fetchWithHeaders(`${baseUrl}/delete-dataset`, {
        method: "POST",
        body: JSON.stringify({ dataset_repo_id: datasetInfo.dataset_repo_id }),
      });
      const data = await response.json();
      if (response.ok && data.success) {
        toast({
          title: "Dataset Deleted",
          description: `${datasetInfo.dataset_repo_id} has been removed from disk.`,
        });
        navigate("/");
      } else {
        toast({
          title: "Delete Failed",
          description: data.message || "Could not delete the dataset.",
          variant: "destructive",
        });
      }
    } catch (error) {
      toast({
        title: "Connection Error",
        description: "Could not connect to the backend server.",
        variant: "destructive",
      });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  // Show loading state while fetching dataset info
  if (isLoadingDatasetInfo || !datasetInfo) {
    return (
      <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface text-ink">
        <div className="h-10 w-10 animate-spin rounded-full border-2 border-line border-t-brand" />
        <p className="mt-4 font-mono text-xs uppercase tracking-[0.12em] text-ink-3">
          Loading dataset information…
        </p>
      </div>
    );
  }

  const isAlreadyOnHub = datasetInfo.source === "both";

  return (
    <div className="min-h-[100dvh] bg-surface text-ink">
      <TopNav />

      <main className="mx-auto max-w-[1400px] px-6 pb-16 pt-28 md:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 border-b border-line pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-center gap-3">
            {uploadSuccess ? (
              <CheckCircle className="h-6 w-6 text-success" />
            ) : (
              <Database className="h-6 w-6 text-ink-3" />
            )}
            <div>
              <Kicker>Dataset</Kicker>
              <h1 className="mt-2 font-mono text-2xl font-bold uppercase tracking-tight text-ink md:text-3xl">
                {uploadSuccess ? "Upload Complete" : "Dataset Upload"}
              </h1>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={() => navigate("/")} variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4" />
              Back to dashboard
            </Button>
            <Button
              onClick={() => setShowDeleteConfirm(true)}
              variant="destructive"
              size="icon"
              disabled={isDeleting}
              aria-label="Delete dataset from disk"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {/* Success State */}
        {uploadSuccess && (
          <Panel className="mt-8" title="Successfully uploaded">
            <div className="mb-4 flex items-center gap-2">
              <StatusDot status="success" label="Live on HuggingFace Hub" />
            </div>
            <p className="mb-5 font-sans text-sm leading-relaxed text-ink-2">
              Your dataset has been uploaded to HuggingFace Hub and is now
              available for training and sharing.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row">
              <Button
                onClick={() => {
                  const spacePath = `/spaces/lerobot/visualize_dataset?path=${encodeURIComponent(
                    `/${datasetInfo.dataset_repo_id}`
                  )}`;
                  const target = uploadConfig.private
                    ? `https://huggingface.co/login?next=${encodeURIComponent(spacePath)}`
                    : `https://huggingface.co${spacePath}`;
                  window.open(target, "_blank", "noopener,noreferrer");
                }}
              >
                <ExternalLink className="h-4 w-4" />
                View on HuggingFace Hub
              </Button>
              <Button
                variant="outline"
                onClick={() =>
                  navigate("/training", {
                    state: { datasetRepoId: datasetInfo.dataset_repo_id },
                  })
                }
              >
                Start Training
              </Button>
            </div>
          </Panel>
        )}

        {/* Upload Form */}
        {!uploadSuccess && (
          <>
            {/* Dataset Summary */}
            <Panel className="mt-8" title="Dataset summary">
              <div className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2">
                <div>
                  <Kicker>Repository ID</Kicker>
                  <p className="mt-1.5 break-all font-mono text-sm text-ink">
                    {datasetInfo.dataset_repo_id}
                  </p>
                </div>
                <div>
                  <Kicker>Task</Kicker>
                  <p className="mt-1.5 font-sans text-sm text-ink">
                    {datasetInfo.single_task}
                  </p>
                </div>
                <div>
                  <Kicker>Episodes recorded</Kicker>
                  <p className="mt-1.5 font-mono text-2xl font-bold tabular-nums text-ink">
                    {datasetInfo.saved_episodes || datasetInfo.num_episodes}
                  </p>
                  {datasetInfo.total_frames && (
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-kicker text-ink-3">
                      {datasetInfo.total_frames} total frames
                    </p>
                  )}
                </div>
                <div>
                  <Kicker>Session duration</Kicker>
                  <p className="mt-1.5 font-mono text-sm tabular-nums text-ink">
                    {formatDuration(datasetInfo.session_elapsed_seconds || 0)}
                  </p>
                  {datasetInfo.fps && (
                    <p className="mt-0.5 font-mono text-[11px] uppercase tracking-kicker text-ink-3">
                      {datasetInfo.fps} FPS
                    </p>
                  )}
                </div>
              </div>
            </Panel>

            {/* Upload Configuration */}
            {!isAlreadyOnHub && (
              <Panel className="mt-6" title="Upload configuration">
                <div className="space-y-6">
                  {/* Tags */}
                  <div className="space-y-2">
                    <Label
                      htmlFor="tags"
                      className="font-mono text-[11px] uppercase tracking-kicker text-ink-2"
                    >
                      Tags (comma-separated)
                    </Label>
                    <Input
                      id="tags"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="robotics, lerobot, manipulation"
                      className="bg-subtle"
                    />
                    <p className="font-sans text-[13px] italic text-ink-3">
                      Tags help others discover your dataset on HuggingFace Hub.
                    </p>
                  </div>

                  {/* Privacy Setting */}
                  <div className="space-y-2">
                    <div className="flex items-center gap-3">
                      <Checkbox
                        id="private"
                        checked={uploadConfig.private}
                        onCheckedChange={(checked) =>
                          setUploadConfig({
                            ...uploadConfig,
                            private: checked as boolean,
                          })
                        }
                      />
                      <div className="flex items-center gap-2">
                        {uploadConfig.private ? (
                          <EyeOff className="h-4 w-4 text-ink-3" />
                        ) : (
                          <Eye className="h-4 w-4 text-ink-3" />
                        )}
                        <Label htmlFor="private" className="text-ink">
                          Make dataset private
                        </Label>
                      </div>
                    </div>
                    <p className="ml-7 font-sans text-[13px] italic text-ink-3">
                      {uploadConfig.private
                        ? "Only you will be able to access this dataset."
                        : "Dataset will be publicly accessible on HuggingFace Hub."}
                    </p>
                  </div>
                </div>
              </Panel>
            )}

            {/* Action Buttons */}
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              {isAlreadyOnHub ? (
                <Button
                  size="lg"
                  onClick={() => openInHubViewer(datasetInfo.dataset_repo_id)}
                >
                  <ExternalLink className="h-4 w-4" />
                  View on Hugging Face Hub
                </Button>
              ) : (
                <>
                  <Button
                    size="lg"
                    onClick={handleUploadToHub}
                    disabled={isUploading}
                  >
                    {isUploading ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Uploading to Hub…
                      </>
                    ) : (
                      <>
                        <UploadIcon className="h-4 w-4" />
                        Upload to HuggingFace Hub
                      </>
                    )}
                  </Button>

                  <Button
                    size="lg"
                    onClick={handleSkipUpload}
                    disabled={isUploading}
                    variant="outline"
                  >
                    Skip Upload
                  </Button>
                </>
              )}
            </div>

            {/* Info Box */}
            {!isAlreadyOnHub && (
              <div className="mt-8 flex items-start gap-3 rounded-panel border border-line bg-subtle px-4 py-4">
                <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-ink-3" />
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-kicker text-ink-2">
                    About HuggingFace Hub upload
                  </div>
                  <ul className="mt-2 space-y-1 font-sans text-[13px] leading-relaxed text-ink-2">
                    <li>
                      Your dataset will be uploaded to HuggingFace Hub for
                      sharing and collaboration.
                    </li>
                    <li>
                      You need to be logged in to HuggingFace CLI on the server.
                    </li>
                    <li>
                      Uploaded datasets can be used for training models and
                      sharing with the community.
                    </li>
                    <li>
                      You can always upload manually later using the HuggingFace
                      CLI.
                    </li>
                  </ul>
                </div>
              </div>
            )}
          </>
        )}
      </main>

      <Footer />

      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent className="border-line bg-elevated text-ink">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete dataset from disk?</AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              This permanently removes{" "}
              <span className="font-mono text-ink">
                {datasetInfo.dataset_repo_id}
              </span>{" "}
              from your local cache. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep dataset</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteDataset}
              disabled={isDeleting}
              className="border border-error bg-transparent text-error hover:bg-error hover:text-white"
            >
              {isDeleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Upload;
