import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  // Press feedback (Phase 16): a 2% scale on press and a 150ms
  // colour transition. Subtle on purpose — buttons never bounce.
  // Reduced motion removes the transform via the global rules.
  // Phase 18 Aurora: focus also carries a soft violet glow, and
  // the radius stays md — no pill-everywhere. The default
  // variant is the violet -> indigo gradient primary; ai and
  // gold are gradient accents. Secondary / outline / ghost
  // join the glass system as translucent white surfaces with
  // a small blur — visible glass, but the primary action
  // keeps the strong gradient so it stays obvious. Never
  // every button transparent: default, ai, gold and
  // destructive stay solid gradients.
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all duration-fast ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:shadow-glow-primary active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default:
          "bg-gradient-primary text-primary-foreground shadow-md hover:shadow-glow-primary hover:brightness-110 active:scale-[0.95]",
        ai: "bg-gradient-ai text-white shadow-md hover:shadow-glow-violet hover:brightness-110 active:scale-[0.95]",
        gold: "bg-gradient-gold text-black shadow-md hover:shadow-glow-warning hover:brightness-110 active:scale-[0.95]",
        secondary:
          "border border-white/15 bg-white/[0.08] text-secondary-foreground shadow-sm backdrop-blur-sm hover:bg-white/[0.12] hover:shadow-elevation-1",
        outline:
          "border border-white/15 bg-white/[0.06] shadow-sm backdrop-blur-sm hover:bg-white/[0.10] hover:text-accent-foreground hover:shadow-glow-primary",
        ghost: "hover:bg-white/10 hover:text-accent-foreground",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-glow-danger",
      },
      size: {
        // Touch targets (Phase 15): default 44px, small 40px, large 48px.
        default: "h-11 px-4 py-2",
        sm: "h-10 rounded-md px-3 text-sm",
        lg: "h-12 rounded-md px-8",
        icon: "h-11 w-11",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
