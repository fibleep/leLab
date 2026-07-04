import React from "react";
import { cn } from "@/lib/utils";

/**
 * North Star Horizon brand primitives. See DESIGN.md.
 * Borders over boxes, one amber accent, Space Mono system voice.
 */

/** Uppercase mono kicker — the machine label above a value or section. */
export const Kicker: React.FC<React.HTMLAttributes<HTMLSpanElement>> = ({
  className,
  ...props
}) => <span className={cn("kicker", className)} {...props} />;

type Semantic = "success" | "warning" | "error" | "info" | "brand" | "muted";

const DOT_COLOR: Record<Semantic, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  info: "bg-info",
  brand: "bg-brand",
  muted: "bg-ink-3",
};

/** 6px semantic status dot + mono label. Never color-only (DESIGN.md). */
export const StatusDot: React.FC<{
  status?: Semantic;
  label?: React.ReactNode;
  className?: string;
}> = ({ status = "muted", label, className }) => (
  <span className={cn("inline-flex items-center gap-2", className)}>
    <span
      className={cn("h-1.5 w-1.5 shrink-0 rounded-full", DOT_COLOR[status])}
      aria-hidden="true"
    />
    {label != null && (
      <span className="font-mono text-[11px] uppercase tracking-kicker text-ink-2">
        {label}
      </span>
    )}
  </span>
);

/** Outlined container. Optional mono kicker header + right-aligned meta. */
export const Panel = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    title?: React.ReactNode;
    meta?: React.ReactNode;
    bodyClassName?: string;
  }
>(({ className, title, meta, bodyClassName, children, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "rounded-panel border border-line bg-elevated",
      className,
    )}
    {...props}
  >
    {(title != null || meta != null) && (
      <div className="flex items-center justify-between border-b border-line-soft px-5 py-3">
        {title != null && <span className="kicker">{title}</span>}
        {meta != null && (
          <span className="font-mono text-[11px] text-ink-3">{meta}</span>
        )}
      </div>
    )}
    <div className={cn("p-5", bodyClassName)}>{children}</div>
  </div>
));
Panel.displayName = "Panel";

/** Numbered workflow row: index circle + title + description + action. */
export const StepRow: React.FC<{
  index: number;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  active?: boolean;
  last?: boolean;
}> = ({ index, title, description, action, active = false, last = false }) => (
  <div className="flex items-start gap-4 py-4">
    <div className="relative flex flex-col items-center self-stretch">
      <span
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-full font-mono text-xs tabular-nums",
          active
            ? "bg-brand text-surface"
            : "border border-line text-ink-3",
        )}
      >
        {index}
      </span>
      {!last && <span className="mt-1 w-px flex-1 bg-line-soft" aria-hidden />}
    </div>
    <div className="flex flex-1 items-center justify-between gap-4 pt-0.5">
      <div className="min-w-0">
        <div className="font-sans text-sm font-medium text-ink">{title}</div>
        {description != null && (
          <div className="font-sans text-[13px] italic text-ink-3 mt-0.5">
            {description}
          </div>
        )}
      </div>
      {action != null && <div className="shrink-0">{action}</div>}
    </div>
  </div>
);
