import React from "react";
import { cn } from "@/lib/utils";

interface DotMatrixHeadingProps {
  /** Words rendered in ink; wrap accent words by passing amberWords. */
  children: React.ReactNode;
  className?: string;
  as?: keyof JSX.IntrinsicElements;
}

/**
 * The signature dot-matrix display headline (see DESIGN.md, `.dot-matrix-text`).
 * Space Mono 700, radial-dot fill clipped to the glyphs. Wrap accent runs in
 * a <span className="dm-amber"> inside children to tint them amber.
 *
 *   <DotMatrixHeading>
 *     DATA BECOMES <span className="dm-amber">POLICY.</span>
 *   </DotMatrixHeading>
 */
const DotMatrixHeading: React.FC<DotMatrixHeadingProps> = ({
  children,
  className,
  as: Tag = "h1",
}) => (
  <Tag
    className={cn(
      "dot-matrix-text text-[clamp(2.5rem,8vw,7rem)]",
      className,
    )}
  >
    {children}
  </Tag>
);

export default DotMatrixHeading;
