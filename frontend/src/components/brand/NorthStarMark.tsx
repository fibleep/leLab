import React from "react";
import { cn } from "@/lib/utils";

interface NorthStarMarkProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
}

/**
 * The North Star mark — a 4-point compass star. Amber by default (currentColor
 * so it can be tinted per context). The brand glyph.
 */
const NorthStarMark: React.FC<NorthStarMarkProps> = ({
  size = 20,
  className,
  ...props
}) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    aria-hidden="true"
    className={cn("text-brand", className)}
    {...props}
  >
    <path
      d="M12 0.5 L14 9.5 L23.5 12 L14 14.5 L12 23.5 L10 14.5 L0.5 12 L10 9.5 Z"
      fill="currentColor"
    />
  </svg>
);

export default NorthStarMark;
