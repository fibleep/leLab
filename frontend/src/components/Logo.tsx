import React from "react";
import { cn } from "@/lib/utils";
import NorthStarMark from "@/components/brand/NorthStarMark";

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  iconOnly?: boolean;
}

const Logo: React.FC<LogoProps> = ({ className, iconOnly = false, ...props }) => {
  return (
    <div className={cn("flex items-center gap-2.5", className)} {...props}>
      <NorthStarMark size={20} />
      {!iconOnly && (
        <span className="font-mono text-sm font-bold uppercase tracking-nav text-ink">
          Horizon
        </span>
      )}
    </div>
  );
};

export default Logo;
