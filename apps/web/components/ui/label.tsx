import * as React from "react";
import { cn } from "@/lib/utils";

export interface LabelProps extends React.LabelHTMLAttributes<HTMLLabelElement> {}

const Label = React.forwardRef<HTMLLabelElement, LabelProps>(
  ({ className, ...props }, ref) => (
    <label
      ref={ref}
      // Phase 18: explicit foreground text so labels never inherit
      // a muted colour from a parent; disabled state unchanged.
      className={cn("text-sm font-medium leading-none text-foreground peer-disabled:cursor-not-allowed peer-disabled:opacity-70", className)}
      {...props}
    />
  ),
);
Label.displayName = "Label";
export { Label };
