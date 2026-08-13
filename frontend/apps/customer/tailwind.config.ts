import type { Config } from "tailwindcss";

// Customer — "Fiber Home": light, calm, generous. Answers one question fast:
// how much internet do I have, and is everything working.
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F6F8FB",
        surface: "#FFFFFF",
        border: "#E4E9F1",
        text: "#101828",
        muted: "#667085",
        brand: "#2F6FED",
        signal: "#0EA5A0",
        warning: "#F5A623",
        critical: "#E14C4C",
      },
      fontFamily: {
        display: ["var(--font-space-grotesk)", "sans-serif"],
        body: ["var(--font-plex-sans)", "sans-serif"],
        mono: ["var(--font-plex-mono)", "monospace"],
      },
      borderRadius: {
        DEFAULT: "10px",
        lg: "16px",
        xl: "20px",
      },
    },
  },
  plugins: [],
};
export default config;
