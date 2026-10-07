/**
 * Accent presets — round 12, part 1.
 *
 * PURE and client-safe: no server-only, no Supabase. The Settings UI (part 2)
 * renders the picker from this module, and the server reads the same keys to
 * set `data-accent` on <html>.
 */

import type { AccentKey } from "@schemas/theme";

export type AccentColor = {
  primary: string;
  primaryForeground: string;
};

export type AccentPreset = {
  key: AccentKey;
  label: string;
  light: AccentColor;
  dark: AccentColor;
};

/**
 * The six presets. `blue` is the default and copies the project's CURRENT
 * `--primary`/`--primary-foreground` values exactly — which are a neutral
 * near-black/near-white (not literal blue) — so the default look never changes.
 *
 * The five colored presets use a saturated hue in light mode and a brighter,
 * higher-lightness hue in dark mode, with a near-white foreground in light mode
 * and a near-black foreground in dark mode (readable contrast in both).
 */
export const ACCENT_PRESETS: Record<AccentKey, AccentPreset> = {
  blue: {
    key: "blue",
    label: "Xanh dương",
    light: { primary: "0 0% 9%", primaryForeground: "0 0% 98%" },
    dark: { primary: "0 0% 98%", primaryForeground: "0 0% 9%" },
  },
  green: {
    key: "green",
    label: "Xanh lá",
    light: { primary: "142 71% 35%", primaryForeground: "0 0% 100%" },
    dark: { primary: "142 71% 45%", primaryForeground: "0 0% 9%" },
  },
  rose: {
    key: "rose",
    label: "Hồng",
    light: { primary: "347 77% 50%", primaryForeground: "0 0% 100%" },
    dark: { primary: "347 77% 62%", primaryForeground: "0 0% 9%" },
  },
  violet: {
    key: "violet",
    label: "Tím",
    light: { primary: "262 83% 58%", primaryForeground: "0 0% 100%" },
    dark: { primary: "262 83% 68%", primaryForeground: "0 0% 9%" },
  },
  orange: {
    key: "orange",
    label: "Cam",
    light: { primary: "24 95% 45%", primaryForeground: "0 0% 100%" },
    dark: { primary: "24 95% 55%", primaryForeground: "0 0% 9%" },
  },
  teal: {
    key: "teal",
    label: "Ngọc lam",
    light: { primary: "173 80% 30%", primaryForeground: "0 0% 100%" },
    dark: { primary: "173 80% 42%", primaryForeground: "0 0% 9%" },
  },
};

/**
 * The preset for `key`, or `null` when the key is missing / unknown. Callers
 * fall back to `blue` (the CSS default) in that case.
 */
export function accentPreset(key: string | null | undefined): AccentPreset | null {
  if (!key) return null;
  return (ACCENT_PRESETS as Record<string, AccentPreset | undefined>)[key] ?? null;
}
