import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition",
  {
    variants: {
      variant: {
        default: "border-line bg-white/5 text-ink",
        // White text on a faint brand tint reads ~13:1 (AA). The old
        // `text-brand on bg-brand-050` was blue-on-navy at ~3.7:1 — below AA in
        // the dark theme, since brand-050 is a dark navy here (not a light tint).
        brand: "border-brand/40 bg-brand/15 text-ink",
        // Solid brand-600 fill lifts white text to ~5.5:1; plain `bg-brand` sat
        // right on the 4.5:1 line.
        active: "border-brand bg-brand-600 text-white",
        muted: "border-line bg-white/5 text-muted",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
