import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        // Semantic colours (Phase 15 tokens): green = profit/success,
        // red = loss/risk, amber = warning, purple = AI, blue = info/brand.
        profit: "hsl(var(--success))",
        loss: "hsl(var(--destructive))",
        success: "hsl(var(--success))",
        warning: "hsl(var(--warning))",
        info: "hsl(var(--info))",
        ai: "hsl(var(--ai))",
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      // Elevation tokens (Phase 17). The same three levels as
      // the CSS vars, so one-off surfaces (sidebar, bottom
      // bar, drawer, raised action) use the same shadows as
      // the shared card classes.
      boxShadow: {
        "elevation-1": "var(--elevation-highlight), var(--elevation-1)",
        "elevation-2": "var(--elevation-highlight), var(--elevation-2)",
        "elevation-3": "var(--elevation-highlight), var(--elevation-3)",
      },
      // Motion tokens (Phase 16). Keyframes live in globals.css;
      // these tokens name them so components use one system.
      transitionDuration: {
        instant: "var(--motion-duration-instant)",
        fast: "var(--motion-duration-fast)",
        base: "var(--motion-duration-base)",
        slow: "var(--motion-duration-slow)",
        count: "var(--motion-duration-count)",
      },
      transitionTimingFunction: {
        standard: "var(--motion-ease-standard)",
        emphasized: "var(--motion-ease-emphasized)",
      },
      animation: {
        "fade-up": "motion-fade-up var(--motion-duration-slow) var(--motion-ease-standard) both",
        "fade-in": "motion-fade-in var(--motion-duration-base) var(--motion-ease-standard) both",
        "scale-in": "motion-scale-in var(--motion-duration-base) var(--motion-ease-emphasized) both",
        "ai-pulse": "motion-ai-pulse 2.4s ease-in-out infinite",
        shimmer: "motion-shimmer 1.6s linear infinite",
        "login-drift": "motion-login-drift 28s ease-in-out infinite alternate",
        "grid-pan": "motion-grid-pan 60s linear infinite",
        "check-draw": "motion-check-draw var(--motion-duration-slow) var(--motion-ease-standard) 120ms both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
