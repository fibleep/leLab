import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

/*
 * North Star Horizon badges — mono, uppercase, subtle backgrounds. See DESIGN.md.
 */
const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] transition-colors",
  {
    variants: {
      variant: {
        default: "border-brand/30 bg-brand-subtle text-brand",
        secondary: "border-line bg-subtle text-ink-2",
        destructive: "border-error/40 bg-transparent text-error",
        outline: "border-line text-ink-2",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
