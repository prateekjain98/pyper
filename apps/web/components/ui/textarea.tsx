import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      className={cn(
        "w-full resize-none rounded-xl border border-line bg-paper-2 px-4 py-3 text-[15px] leading-relaxed text-ink outline-none transition placeholder:text-muted/60 focus-visible:border-brand/50 focus-visible:ring-2 focus-visible:ring-brand/25",
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = "Textarea";

export { Textarea };
