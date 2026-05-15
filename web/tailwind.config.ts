import type { Config } from "tailwindcss";

export default {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./node_modules/@tremor/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        tremor: {
          brand: {
            faint: "#0b1229",
            muted: "#172554",
            subtle: "#1e40af",
            DEFAULT: "#a78bfa",
            emphasis: "#c4b5fd",
            inverted: "#030712",
          },
          background: {
            muted: "#0a0a0f",
            subtle: "#101016",
            DEFAULT: "#0f0f14",
            emphasis: "#ededf2",
          },
          border: { DEFAULT: "#1f1f2a" },
          ring: { DEFAULT: "#27272a" },
          content: {
            subtle: "#5e5e6e",
            DEFAULT: "#8b8b9a",
            emphasis: "#d4d4d8",
            strong: "#ededf2",
            inverted: "#0a0a0f",
          },
        },
      },
      boxShadow: {
        "tremor-input": "0 1px 2px 0 rgb(0 0 0 / 0.05)",
        "tremor-card":
          "0 1px 3px 0 rgb(0 0 0 / 0.5), 0 8px 32px -16px rgb(0 0 0 / 0.4)",
        "tremor-dropdown":
          "0 4px 6px -1px rgb(0 0 0 / 0.5), 0 2px 4px -2px rgb(0 0 0 / 0.5)",
      },
      borderRadius: {
        "tremor-small": "0.375rem",
        "tremor-default": "0.5rem",
        "tremor-full": "9999px",
      },
      fontSize: {
        "tremor-label": ["0.75rem", { lineHeight: "1rem" }],
        "tremor-default": ["0.875rem", { lineHeight: "1.25rem" }],
        "tremor-title": ["1.125rem", { lineHeight: "1.75rem" }],
        "tremor-metric": ["1.875rem", { lineHeight: "2.25rem" }],
      },
    },
  },
  safelist: [
    {
      pattern:
        /^(bg|text|border|ring|stroke|fill)-(slate|gray|zinc|red|amber|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|100|200|300|400|500|600|700|800|900|950)$/,
      variants: ["hover", "ui-selected"],
    },
  ],
  plugins: [],
} satisfies Config;
