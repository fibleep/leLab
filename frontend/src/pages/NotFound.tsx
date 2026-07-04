import { useLocation } from "react-router-dom";
import { useEffect } from "react";
import NorthStarMark from "@/components/brand/NorthStarMark";
import { Kicker } from "@/components/brand/primitives";

const NotFound = () => {
  const location = useLocation();

  useEffect(() => {
    console.error(
      "404 Error: User attempted to access non-existent route:",
      location.pathname
    );
  }, [location.pathname]);

  return (
    <div className="flex min-h-[100dvh] flex-col items-center justify-center bg-surface px-6 text-ink">
      <NorthStarMark size={44} className="text-ink-3" />
      <div className="mt-8 font-mono text-[clamp(4rem,14vw,9rem)] font-bold leading-none tracking-tight tabular-nums text-ink">
        404
      </div>
      <Kicker className="mt-4">Route not found</Kicker>
      <p className="mt-3 max-w-sm text-center font-sans text-sm leading-relaxed text-ink-2">
        The page you requested does not exist. Check the address or head back to
        the dashboard.
      </p>
      <a
        href="/"
        className="mt-8 inline-flex items-center gap-2 rounded-full bg-brand px-5 py-2.5 font-mono text-xs uppercase tracking-[0.1em] text-surface transition-colors hover:bg-brand-muted active:opacity-70"
      >
        Back to dashboard
      </a>
    </div>
  );
};

export default NotFound;
