import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/*
 * Badge (Phase 18 Aurora). Small, semibold, pill-shaped status
 * and value markers — strategy tags, trade status, P&L
 * direction, risk level, AI marks, achievement tiers. Every
 * variant is a tinted background + matching border + coloured
 * text, so the badge reads on any glass surface; nothing here
 * is a solid block of colour, except the default variant,
 * which uses the violet -> indigo primary gradient (white
 * text is 5.67:1 / 6.47:1 on its stops — a solid light violet
 * would fail). Text colours are lightened versions of the
 * token hues (e.g. hsl(152 69% 65%) instead of --success) so
 * they pass contrast on the dark tinted background; the info
 * and gold texts follow the aurora palette (#346CE6 family
 * and #BD935F family). Same props/API pattern as Button;
 * other workers use this for strategy/status/P&L badges.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold tabular-nums",
  {
    variants: {
      variant: {
        default: "border-transparent bg-gradient-primary text-white",
        profit: "border-success/30 bg-success/15 text-[hsl(152_69%_65%)]",
        loss: "border-destructive/30 bg-destructive/15 text-[hsl(0_85%_70%)]",
        warning: "border-warning/30 bg-warning/15 text-[hsl(38_92%_65%)]",
        info: "border-info/30 bg-info/15 text-[hsl(221_70%_75%)]",
        ai: "border-ai/40 bg-ai/15 text-[hsl(262_83%_78%)]",
        gold: "border-gold/40 bg-gold/15 text-[hsl(33_45%_70%)]",
        neutral: "border-border bg-muted text-muted-foreground",
      },
    },
    defaultVariants: { variant: "default" },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ variant, className }))} {...props} />
  ),
);
Badge.displayName = "Badge";

export { Badge, badgeVariants };
