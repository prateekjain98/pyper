import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold outline-none transition disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-brand/40",
  {
    variants: {
      variant: {
        default:
          "bg-brand text-white shadow-[0_12px_30px_-12px_rgba(32,86,223,0.7)] hover:-translate-y-0.5 hover:bg-brand-600",
        outline: "border border-line bg-white/5 text-ink hover:border-ink/25 hover:bg-white/10",
        secondary: "border border-line bg-surface text-ink hover:bg-white/5",
        ghost: "text-ink/70 hover:bg-white/5 hover:text-ink",
      },
      size: {
        default: "h-11 px-6",
        sm: "h-9 px-4 text-[13px]",
        lg: "h-12 px-8 text-[15px]",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => (
    <button ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />
  ),
);
Button.displayName = "Button";

export { Button, buttonVariants };
