/**
 * Sidebar presets — round 14, part 1.
 *
 * PURE and client-safe (no server-only, no Supabase). The theme palette renders
 * from this module and the server reads the same keys to set `data-sidebar` on
 * <html>.
 */

import type { SidebarKey } from "@schemas/theme";

export type SidebarColor = {
  sidebar: string;
  sidebarForeground: string;
};

export type SidebarPreset = {
  key: SidebarKey;
  label: string;
  light: SidebarColor;
  dark: SidebarColor;
};

/**
 * The six presets. `default` copies the project's CURRENT `--sidebar-background`
 * and `--sidebar-foreground` values exactly (near-white in light, near-black in
 * dark) so the default look never changes.
 *
 * `navy` is a deliberately dark sidebar in BOTH modes with a near-white
 * foreground (per the requirement); the other colored presets are soft tints —
 * light in light mode, dark in dark mode — so the foreground stays readable.
 */
export const SIDEBAR_PRESETS: Record<SidebarKey, SidebarPreset> = {
  default: {
    key: "default",
    label: "Mặc định",
    light: { sidebar: "0 0% 98%", sidebarForeground: "240 5.3% 26.1%" },
    dark: { sidebar: "240 5.9% 10%", sidebarForeground: "240 4.8% 95.9%" },
  },
  gray: {
    key: "gray",
    label: "Xám",
    light: { sidebar: "220 14% 90%", sidebarForeground: "220 14% 20%" },
    dark: { sidebar: "220 14% 16%", sidebarForeground: "220 14% 88%" },
  },
  blue: {
    key: "blue",
    label: "Xanh nhạt",
    light: { sidebar: "210 40% 92%", sidebarForeground: "210 40% 20%" },
    dark: { sidebar: "210 40% 16%", sidebarForeground: "210 40% 90%" },
  },
  navy: {
    key: "navy",
    label: "Xanh đậm",
    light: { sidebar: "222 47% 20%", sidebarForeground: "210 40% 98%" },
    dark: { sidebar: "222 47% 14%", sidebarForeground: "210 40% 98%" },
  },
  violet: {
    key: "violet",
    label: "Tím",
    light: { sidebar: "262 40% 90%", sidebarForeground: "262 40% 22%" },
    dark: { sidebar: "262 40% 16%", sidebarForeground: "262 40% 90%" },
  },
  cream: {
    key: "cream",
    label: "Kem",
    light: { sidebar: "48 100% 94%", sidebarForeground: "30 20% 25%" },
    dark: { sidebar: "30 20% 16%", sidebarForeground: "40 40% 90%" },
  },
};

/**
 * The preset for `key`, or `null` when the key is missing / unknown. Callers
 * fall back to `default` in that case.
 */
export function sidebarPreset(
  key: string | null | undefined,
): SidebarPreset | null {
  if (!key) return null;
  return (SIDEBAR_PRESETS as Record<string, SidebarPreset | undefined>)[key] ?? null;
}
