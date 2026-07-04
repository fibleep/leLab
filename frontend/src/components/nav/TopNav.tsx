import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { Circle, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import NorthStarMark from "@/components/brand/NorthStarMark";
import HfAuthChip from "@/components/landing/HfAuthChip";

/*
 * North Star Horizon top chrome — floating pill nav (see DESIGN.md).
 * Centered pill: brand mark + nav links + RECORD EPISODE action.
 * Outside the pill (top-right): HF status chip + help.
 *
 * Purely presentational routing — same routes the app already exposes; no
 * behavior change. `onRecord` lets a page wire RECORD EPISODE to its own
 * record flow; without it the action routes to the dashboard.
 */

const NAV_LINKS: { to: string; label: string }[] = [
  { to: "/", label: "Dashboard" },
  { to: "/upload", label: "Datasets" },
  { to: "/training", label: "Training" },
  { to: "/vr", label: "VR" },
];

interface TopNavProps {
  onRecord?: () => void;
  onHelp?: () => void;
}

const TopNav: React.FC<TopNavProps> = ({ onRecord, onHelp }) => {
  const navigate = useNavigate();

  const handleRecord = () => {
    if (onRecord) onRecord();
    else navigate("/");
  };

  return (
    <>
      <div className="pointer-events-none fixed top-5 left-0 right-0 z-40 flex justify-center px-4">
        <nav className="pointer-events-auto flex items-center gap-5 rounded-full border border-line bg-[var(--nav-pill)] py-2 pl-6 pr-2 backdrop-blur-md md:gap-7">
          <NavLink to="/" className="flex items-center gap-2.5">
            <NorthStarMark size={18} />
            <span className="hidden font-mono text-sm font-bold uppercase tracking-nav text-ink sm:inline">
              Horizon
            </span>
          </NavLink>

          <span className="h-4 w-px bg-line" aria-hidden />

          <div className="flex items-center gap-4 md:gap-6">
            {NAV_LINKS.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                end={link.to === "/"}
                className={({ isActive }) =>
                  cn(
                    "font-mono text-xs uppercase tracking-[0.1em] transition-colors hover:text-ink",
                    isActive ? "text-ink" : "text-ink-3",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </div>

          <button
            type="button"
            onClick={handleRecord}
            className="flex items-center gap-2 rounded-full bg-brand px-4 py-2 font-mono text-xs uppercase tracking-[0.1em] text-surface transition-colors hover:bg-brand-muted active:opacity-70"
          >
            <Circle className="h-3 w-3 fill-current" />
            Record Episode
          </button>
        </nav>
      </div>

      <div className="pointer-events-none fixed top-5 right-4 z-40 hidden items-center gap-2 lg:flex">
        <div className="pointer-events-auto">
          <HfAuthChip />
        </div>
        <button
          type="button"
          onClick={onHelp}
          aria-label="Help"
          className="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-line bg-elevated text-ink-3 transition-colors hover:text-ink"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </div>
    </>
  );
};

export default TopNav;
