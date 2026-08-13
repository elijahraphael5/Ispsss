import type { Config } from "tailwindcss";

// Admin — "Signal Room": dense, dark, precise. Mirrors a NOC console, not a
// generic SaaS dashboard. Hairline borders, near-zero radius, mono for data.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0B0F17",
        surface: "#111827",
        surface2: "#161F2E",
        border: "#232D3F",
        text: "#E7ECF3",
        muted: "#7C8798",
        signal: "#33D6A6",
        warning: "#F5A623",
        critical: "#EF5A5A",
        offline: "#48566B",
        brand: "#33D6A6",
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-plex-sans)", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },
      borderRadius: {
        DEFAULT: "3px",
        md: "4px",
        lg: "6px",
      },
    },
  },
  plugins: [],
};
export default config;
