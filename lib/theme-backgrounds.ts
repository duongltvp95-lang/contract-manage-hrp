/**
 * Background presets — round 13, part 1.
 *
 * PURE and client-safe (no server-only, no Supabase). The Settings UI renders
 * the picker from this module and the server reads the same keys to set
 * `data-background` on <html>.
 */

import type { BackgroundKey } from "@schemas/theme";

export type BackgroundColor = {
  background: string;
};

export type BackgroundPreset = {
  key: BackgroundKey;
  label: string;
  light: BackgroundColor;
  dark: BackgroundColor;
};

/**
 * The six presets. `default` copies the project's CURRENT `--background` values
 * exactly (white in light mode, near-black in dark mode) so the default look
 * never changes.
 *
 * The five colored presets are soft tints: very high lightness in light mode
 * (~96–98%) and very low lightness in dark mode (~12%) so the existing
 * `--foreground` (near-black / near-white) stays readable in both modes.
 */
export const BACKGROUND_PRESETS: Record<BackgroundKey, BackgroundPreset> = {
  default: {
    key: "default",
    label: "Mặc định",
    light: { background: "0 0% 100%" },
    dark: { background: "0 0% 3.9%" },
  },
  gray: {
    key: "gray",
    label: "Xám",
    light: { background: "220 14% 96%" },
    dark: { background: "220 14% 12%" },
  },
  blue: {
    key: "blue",
    label: "Xanh dương",
    light: { background: "210 40% 98%" },
    dark: { background: "210 40% 12%" },
  },
  green: {
    key: "green",
    label: "Xanh lá",
    light: { background: "150 30% 97%" },
    dark: { background: "150 30% 12%" },
  },
  cream: {
    key: "cream",
    label: "Kem",
    light: { background: "48 100% 97%" },
    dark: { background: "30 20% 12%" },
  },
  pink: {
    key: "pink",
    label: "Hồng",
    light: { background: "350 40% 98%" },
    dark: { background: "350 30% 12%" },
  },
};

/**
 * The preset for `key`, or `null` when the key is missing / unknown. Callers
 * fall back to `default` in that case.
 */
export function backgroundPreset(
  key: string | null | undefined,
): BackgroundPreset | null {
  if (!key) return null;
  return (BACKGROUND_PRESETS as Record<string, BackgroundPreset | undefined>)[key] ?? null;
}
