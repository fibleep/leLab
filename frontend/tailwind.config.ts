import type { Config } from "tailwindcss";

/*
 * North Star Horizon theme — see DESIGN.md. Raw token custom properties live
 * in src/index.css; this maps them to Tailwind classes. Paper-first, one amber
 * accent, borders over boxes, Space Mono (system) + Geist (human).
 */
export default {
	darkMode: ["class", '[data-theme="dark"]'],
	content: [
		"./pages/**/*.{ts,tsx}",
		"./components/**/*.{ts,tsx}",
		"./app/**/*.{ts,tsx}",
		"./src/**/*.{ts,tsx}",
	],
	prefix: "",
	theme: {
		container: {
			center: true,
			padding: "1.5rem",
			screens: { "2xl": "1400px" },
		},
		extend: {
			fontFamily: {
				sans: ['"Geist"', "system-ui", "-apple-system", "sans-serif"],
				mono: ['"Space Mono"', "ui-monospace", "monospace"],
			},
			colors: {
				// New token palette (preferred).
				surface: "var(--surface)",
				elevated: "var(--elevated)",
				subtle: "var(--subtle)",
				ink: {
					DEFAULT: "var(--ink)",
					2: "var(--ink-2)",
					3: "var(--ink-3)",
				},
				line: {
					DEFAULT: "var(--line)",
					soft: "var(--line-soft)",
				},
				brand: {
					DEFAULT: "var(--brand)",
					muted: "var(--brand-muted)",
					subtle: "var(--brand-subtle)",
				},
				success: "var(--success)",
				warning: "var(--warning)",
				error: "var(--error)",
				info: "var(--info)",

				// shadcn-compatibility aliases → mapped to tokens so existing
				// primitives render on-theme without rewrites.
				border: "var(--line)",
				input: "var(--line)",
				ring: "var(--brand)",
				background: "var(--surface)",
				foreground: "var(--ink)",
				primary: {
					DEFAULT: "var(--brand)",
					foreground: "var(--surface)",
				},
				secondary: {
					DEFAULT: "var(--subtle)",
					foreground: "var(--ink)",
				},
				destructive: {
					DEFAULT: "var(--error)",
					foreground: "#ffffff",
				},
				muted: {
					DEFAULT: "var(--subtle)",
					foreground: "var(--ink-3)",
				},
				accent: {
					DEFAULT: "var(--subtle)",
					foreground: "var(--ink)",
				},
				popover: {
					DEFAULT: "var(--elevated)",
					foreground: "var(--ink)",
				},
				card: {
					DEFAULT: "var(--elevated)",
					foreground: "var(--ink)",
				},
			},
			borderRadius: {
				panel: "var(--radius-panel)",
				lg: "var(--radius)",
				md: "calc(var(--radius) - 2px)",
				sm: "calc(var(--radius) - 4px)",
			},
			letterSpacing: {
				kicker: "0.12em",
				nav: "0.2em",
			},
			keyframes: {
				"accordion-down": {
					from: { height: "0" },
					to: { height: "var(--radix-accordion-content-height)" },
				},
				"accordion-up": {
					from: { height: "var(--radix-accordion-content-height)" },
					to: { height: "0" },
				},
			},
			animation: {
				"accordion-down": "accordion-down 0.2s ease-out",
				"accordion-up": "accordion-up 0.2s ease-out",
			},
		},
	},
	plugins: [require("tailwindcss-animate")],
} satisfies Config;
