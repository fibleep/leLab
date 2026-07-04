import React, { useCallback, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import VisualizerPanel from "@/components/control/VisualizerPanel";
import TeleopCameraPanel from "@/components/control/TeleopCameraPanel";
import TopNav from "@/components/nav/TopNav";
import Footer from "@/components/Footer";
import { useToast } from "@/hooks/use-toast";
import { useApi } from "@/contexts/ApiContext";

const TeleoperationPage = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { baseUrl, fetchWithHeaders } = useApi();

  // Stop teleoperation exactly once, however the user leaves, so the back
  // button, an in-app link, and the unmount safety net can't double-stop or
  // double-toast.
  const stoppedRef = useRef(false);
  const stopTeleoperation = useCallback(async () => {
    if (stoppedRef.current) return;
    stoppedRef.current = true;
    try {
      const res = await fetchWithHeaders(`${baseUrl}/stop-teleoperation`, {
        method: "POST",
      });
      const data = await res.json();
      if (data?.success) {
        toast({
          title: "Teleoperation stopped",
          description: "The arm was disconnected cleanly.",
        });
      }
    } catch {
      /* best-effort */
    }
  }, [baseUrl, fetchWithHeaders, toast]);

  // Cover every exit path so a session can't keep running and block the next
  // start with "already active":
  //   - the back button awaits stopTeleoperation() then navigates (below);
  //   - any other in-app navigation unmounts this component → stop via cleanup;
  //   - a browser-level leave (URL change, reload, tab close) never runs React
  //     cleanup, so `pagehide` fires a keepalive stop that survives the unload
  //     and stashes a flag the next page reads to confirm the clean disconnect.
  //     It uses a bare fetch (no JSON Content-Type) so the request stays a CORS
  //     "simple request" and isn't dropped to a preflight mid-unload.
  useEffect(() => {
    const handlePageHide = () => {
      try {
        sessionStorage.setItem("lelab:teleop-stopped", "1");
      } catch {
        /* sessionStorage may be unavailable; the stop below still runs */
      }
      fetch(`${baseUrl}/stop-teleoperation`, {
        method: "POST",
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener("pagehide", handlePageHide);

    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      stopTeleoperation();
    };
  }, [baseUrl, stopTeleoperation]);

  const handleGoBack = async () => {
    await stopTeleoperation();
    navigate("/");
  };

  return (
    <div className="min-h-screen bg-surface text-ink">
      <TopNav />
      <main className="mx-auto flex max-w-[1400px] flex-col px-6 pb-12 pt-28 md:px-8">
        <div className="flex min-h-[70vh] lg:h-[calc(100dvh-13rem)]">
          <VisualizerPanel
            onGoBack={handleGoBack}
            className="lg:w-full"
            rightSlot={<TeleopCameraPanel />}
          />
        </div>
      </main>
      <Footer />
    </div>
  );
};

export default TeleoperationPage;
