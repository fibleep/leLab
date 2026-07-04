import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/brand/primitives";
import { HubJob } from "@/lib/jobsApi";
import { ExternalLink } from "lucide-react";

interface Props {
  job: HubJob;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diff = Math.max(0, (Date.now() - t) / 1000);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

type DotStatus = "brand" | "success" | "warning" | "error" | "muted";

interface StagePresentation {
  label: string;
  status: DotStatus;
}

const stagePresentation: Record<string, StagePresentation> = {
  RUNNING: { label: "Running", status: "brand" },
  QUEUED: { label: "Queued", status: "warning" },
  SCHEDULING: { label: "Scheduling", status: "warning" },
  COMPLETED: { label: "Done", status: "success" },
  FAILED: { label: "Failed", status: "error" },
  // HF API uses "CANCELED" (single L); accept both spellings.
  CANCELED: { label: "Cancelled", status: "warning" },
  CANCELLED: { label: "Cancelled", status: "warning" },
};

const HubJobCard: React.FC<Props> = ({ job }) => {
  const stage = job.status?.stage?.toUpperCase() ?? "";
  const present: StagePresentation = stagePresentation[stage] ?? {
    label: stage || "Unknown",
    status: "muted",
  };
  const title =
    job.docker_image ?? job.space_id ?? `Job ${job.id.slice(0, 12)}…`;

  return (
    <Card
      onClick={() => window.open(job.url, "_blank", "noopener,noreferrer")}
      className="cursor-pointer transition-colors hover:border-ink-3"
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <StatusDot status={present.status} label={present.label} />
          <Button
            variant="ghost"
            size="icon"
            asChild
            className="h-7 w-7"
            aria-label="View on Hub"
          >
            <a
              href={job.url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
            >
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </Button>
        </div>
        <div>
          <div
            className="font-sans text-sm font-medium text-ink truncate"
            title={title}
          >
            {title}
          </div>
          <div className="font-mono text-[11px] text-ink-3 truncate">
            {job.flavor ?? "—"} · {relativeTime(job.created_at)}
            {job.owner ? ` · ${job.owner}` : ""}
          </div>
        </div>
        {job.status?.message ? (
          <div
            className="font-mono text-[11px] text-ink-3 truncate"
            title={job.status.message}
          >
            {job.status.message}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
};

export default HubJobCard;
