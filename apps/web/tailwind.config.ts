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
        // Phase 18 Aurora extended accents. Single-value colours (no
        // numbered scale): cyan is the aurora blue (#2971A4,
        // lightened for readability), violet the text-readable
        // violet accent (same value as --ai), indigo the
        // violet-to-blue bridge, gold the supplied #BD935F
        // (premium only), magenta the supplied #81268E
        // (atmospheric only — never a surface or button). No
        // existing code used the numbered cyan / violet /
        // indigo / gold scales, so replacing them is safe.
        cyan: "hsl(var(--cyan))",
        violet: "hsl(var(--violet))",
        indigo: "hsl(var(--indigo))",
        gold: "hsl(var(--gold))",
        magenta: "hsl(var(--magenta))",
      },
      // Phase 18 — one font family for the whole app. Inter is
      // loaded via next/font/google in layout.tsx as --font-sans;
      // the system stack is the fallback if the variable is ever
      // missing, so text never renders in an unexpected face.
      fontFamily: {
        sans: [
          "var(--font-sans)",
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
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
        // Phase 18 Aurora glow shadows. Soft and low-opacity by
        // design: a glow marks one focal surface, it is not a
        // default. Primary is violet now; blue is the #346CE6
        // secondary glow.
        "glow-primary": "var(--glow-primary)",
        "glow-blue": "var(--glow-blue)",
        "glow-cyan": "var(--glow-cyan)",
        "glow-violet": "var(--glow-violet)",
        "glow-success": "var(--glow-success)",
        "glow-danger": "var(--glow-danger)",
        "glow-warning": "var(--glow-warning)",
      },
      // Phase 18 Aurora gradients. bg-gradient-primary / -cyan /
      // -ai / -gold / -hero. Primary is violet -> indigo; the
      // hero gradient is an aurora sweep (midnight purple to
      // purple-black to aurora blue) for the focal card.
      backgroundImage: {
        "gradient-primary": "var(--gradient-primary)",
        "gradient-cyan": "var(--gradient-cyan)",
        "gradient-ai": "var(--gradient-ai)",
        "gradient-gold": "var(--gradient-gold)",
        "gradient-hero": "var(--gradient-hero)",
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
        // Phase 18 — ambient orb drift: 70s, transform only.
        "orb-drift": "motion-orb-drift 70s ease-in-out infinite alternate",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
