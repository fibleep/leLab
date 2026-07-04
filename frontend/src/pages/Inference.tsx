import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import TopNav from "@/components/nav/TopNav";
import Footer from "@/components/Footer";
import { Kicker, Panel } from "@/components/brand/primitives";
import { useApi } from "@/contexts/ApiContext";
import { useToast } from "@/hooks/use-toast";
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
import {
  InferenceStatus,
  getInferenceStatus,
  stopInference,
} from "@/lib/inferenceApi";

const POLL_MS = 1000;

function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(s / 60);
  const secs = s % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

const Inference: React.FC = () => {
  const navigate = useNavigate();
  const { baseUrl, fetchWithHeaders } = useApi();
  const { toast } = useToast();
  const [status, setStatus] = useState<InferenceStatus | null>(null);
  const [showStopConfirm, setShowStopConfirm] = useState(false);
  const navigatedAwayRef = useRef(false);
  // Independent flag: we may request a stop (safety net) before the run
  // is actually inactive. We must not flip navigatedAwayRef yet — that
  // would block the natural completion path on the next tick.
  const stopRequestedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    const stopIfHung = async () => {
      try {
        await stopInference(baseUrl, fetchWithHeaders);
      } catch {
        // The next status poll will surface the failure if it persists.
      }
    };
    const tick = async () => {
      try {
        const next = await getInferenceStatus(baseUrl, fetchWithHeaders);
        if (cancelled) return;
        setStatus(next);
        // Auto-bounce home once the run is done.
        if (!next.inference_active && !navigatedAwayRef.current) {
          navigatedAwayRef.current = true;
          if (next.exited) {
            toast({
              title: "Inference finished",
              description:
                next.exit_code === 0
                  ? "Run completed."
                  : `Exit code ${next.exit_code}. See ${next.log_path}.`,
              variant: next.exit_code === 0 ? "default" : "destructive",
            });
          }
          navigate("/");
          return;
        }
        // Safety net: only fire after the rollout *main loop* has actually
        // started (lerobot honours --duration there). Setup time — policy
        // load, snapshot_download, bus connect, camera connect — can take
        // 10–30s and must NOT count against the user's configured duration.
        if (
          next.inference_active &&
          next.rollout_started_at != null &&
          next.duration_s != null &&
          next.duration_s > 0 &&
          next.rollout_elapsed_s > next.duration_s + 10 &&
          !stopRequestedRef.current
        ) {
          stopRequestedRef.current = true;
          toast({
            title: "Inference seems hung",
            description: `Rollout past duration by ${Math.round(
              next.rollout_elapsed_s - next.duration_s,
            )}s. Stopping.`,
            variant: "destructive",
          });
          stopIfHung();
        }
      } catch (e) {
        if (!cancelled) {
          toast({
            title: "Lost connection to backend",
            description: e instanceof Error ? e.message : String(e),
            variant: "destructive",
          });
        }
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [baseUrl, fetchWithHeaders, navigate, toast]);

  const handleStop = async () => {
    setShowStopConfirm(false);
    try {
      await stopInference(baseUrl, fetchWithHeaders);
      // Status poll will catch the inactive state and navigate home.
    } catch (e) {
      toast({
        title: "Stop failed",
        description: e instanceof Error ? e.message : String(e),
        variant: "destructive",
      });
    }
  };

  if (!status) {
    return (
      <div className="min-h-screen bg-surface text-ink">
        <TopNav />
        <div className="mx-auto flex max-w-[1400px] items-center justify-center px-6 pb-16 pt-28 font-mono text-sm uppercase tracking-[0.1em] text-ink-3 md:px-8">
          <Loader2 className="w-5 h-5 animate-spin mr-3" /> Connecting to inference…
        </div>
        <Footer />
      </div>
    );
  }

  const setupElapsed = status.elapsed_s ?? 0;
  const rolloutElapsed = status.rollout_elapsed_s ?? 0;
  const duration = status.duration_s ?? 0;
  const isSettingUp = status.inference_active && status.rollout_started_at == null;
  const isRunning = status.inference_active && status.rollout_started_at != null;
  // When setting up: progress is uncertain — show a soft pulsing bar.
  // When rolling out: progress is rolloutElapsed / duration.
  const pct =
    isRunning && duration > 0
      ? Math.min(100, (rolloutElapsed / duration) * 100)
      : 0;
  const pillLabel = isSettingUp
    ? "SETTING UP"
    : isRunning
    ? "RUNNING"
    : "FINISHED";
  const timerSeconds = isRunning ? rolloutElapsed : setupElapsed;

  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      <TopNav />
      <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col px-6 pb-16 pt-28 md:px-8">
        <div className="mb-8">
          <Kicker>Inference</Kicker>
          <h1 className="mt-2 font-mono text-2xl font-bold uppercase tracking-tight text-ink">
            Run policy on robot
          </h1>
        </div>

        <div className="flex flex-1 items-center justify-center">
          <Panel className="w-full max-w-xl" bodyClassName="p-8">
            <div className="mb-6 text-center">
              <div className="inline-flex items-center gap-2 rounded-full border border-line bg-subtle px-3 py-1 font-mono text-[11px] uppercase tracking-kicker text-ink-2">
                <span
                  className={`h-1.5 w-1.5 rounded-full animate-pulse ${
                    isSettingUp ? "bg-warning" : "bg-success"
                  }`}
                  aria-hidden="true"
                />
                {pillLabel}
              </div>
            </div>

            <div className="mb-4 text-center">
              <div className="font-mono text-7xl font-bold leading-none tabular-nums text-ink">
                {formatTime(timerSeconds)}
              </div>
              <div className="mt-2 font-mono text-xs uppercase tracking-kicker text-ink-3">
                {isSettingUp
                  ? "Loading policy & connecting hardware…"
                  : `/ ${formatTime(duration)}`}
              </div>
            </div>

            <div className="mb-8 h-1.5 w-full rounded-full bg-subtle">
              <div
                className={`h-1.5 rounded-full transition-all duration-500 ${
                  isSettingUp ? "w-full animate-pulse bg-brand/40" : "bg-brand"
                }`}
                style={isSettingUp ? undefined : { width: `${pct}%` }}
              />
            </div>

            <div className="mb-6 break-all rounded-panel border border-line bg-subtle px-3 py-2 font-mono text-xs text-ink-2">
              policy: {status.policy_ref ?? "(unknown)"}
            </div>

            <Button
              onClick={() => setShowStopConfirm(true)}
              disabled={!status.inference_active}
              variant="destructive"
              size="lg"
              className="w-full disabled:opacity-50"
            >
              <Square className="w-5 h-5 mr-2" />
              Stop
            </Button>
          </Panel>
        </div>
      </div>

      <Footer />

      <AlertDialog open={showStopConfirm} onOpenChange={setShowStopConfirm}>
        <AlertDialogContent className="border border-line bg-elevated text-ink">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-mono uppercase tracking-[0.05em]">
              Stop inference?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-ink-2">
              The follower will hold its current pose. You can launch another
              run from the job tile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-line bg-elevated text-ink hover:bg-subtle">
              Keep running
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleStop}
              className="border border-error bg-transparent text-error hover:bg-error hover:text-white"
            >
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default Inference;
