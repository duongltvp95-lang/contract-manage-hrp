import { describe, expect, it } from "vitest";

import { SIDEBAR_PRESETS, sidebarPreset } from "@/lib/theme-sidebars";
import { SIDEBAR_KEYS } from "@schemas/theme";
import { UpdateProfileSchema } from "@schemas/profile";

/**
 * Round 14, part 1 — sidebar presets + schema.
 */

const HSL_RE = /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/;

describe("SIDEBAR_PRESETS", () => {
  it("declares exactly six presets with a Vietnamese label", () => {
    expect(Object.keys(SIDEBAR_PRESETS).sort()).toEqual(
      ["default", "gray", "blue", "navy", "violet", "cream"].sort(),
    );
    for (const key of SIDEBAR_KEYS) {
      expect(SIDEBAR_PRESETS[key].key).toBe(key);
      expect(SIDEBAR_PRESETS[key].label).toBeTruthy();
    }
  });

  it("uses valid HSL for every light and dark sidebar + foreground", () => {
    for (const preset of Object.values(SIDEBAR_PRESETS)) {
      expect(HSL_RE.test(preset.light.sidebar)).toBe(true);
      expect(HSL_RE.test(preset.light.sidebarForeground)).toBe(true);
      expect(HSL_RE.test(preset.dark.sidebar)).toBe(true);
      expect(HSL_RE.test(preset.dark.sidebarForeground)).toBe(true);
    }
  });

  it("copies the project's CURRENT --sidebar values exactly for the default preset", () => {
    // Hardcoded constants (not read from the CSS file): the current
    // `app/globals.css` :root / .dark `--sidebar-background` and
    // `--sidebar-foreground`.
    expect(SIDEBAR_PRESETS.default.light).toEqual({
      sidebar: "0 0% 98%",
      sidebarForeground: "240 5.3% 26.1%",
    });
    expect(SIDEBAR_PRESETS.default.dark).toEqual({
      sidebar: "240 5.9% 10%",
      sidebarForeground: "240 4.8% 95.9%",
    });
  });

  it("keeps navy dark with a near-white foreground in both modes", () => {
    const navy = SIDEBAR_PRESETS.navy;
    const lightL = parseFloat(navy.light.sidebar.split(" ")[2]);
    const darkL = parseFloat(navy.dark.sidebar.split(" ")[2]);
    expect(lightL).toBeLessThanOrEqual(30);
    expect(darkL).toBeLessThanOrEqual(20);
    expect(navy.light.sidebarForeground).toBe("210 40% 98%");
    expect(navy.dark.sidebarForeground).toBe("210 40% 98%");
  });
});

describe("sidebarPreset", () => {
  it("returns the preset for a valid key", () => {
    expect(sidebarPreset("navy")?.key).toBe("navy");
    expect(sidebarPreset("default")?.key).toBe("default");
  });

  it("returns null for an unknown or missing key (caller falls back to default)", () => {
    expect(sidebarPreset("hotpink")).toBeNull();
    expect(sidebarPreset(null)).toBeNull();
    expect(sidebarPreset(undefined)).toBeNull();
    expect(sidebarPreset("")).toBeNull();
  });
});

describe("UpdateProfileSchema.sidebarColor", () => {
  it("accepts a valid key, null, or an omitted value", () => {
    expect(UpdateProfileSchema.parse({ fullName: "A", sidebarColor: "navy" }).sidebarColor).toBe("navy");
    expect(UpdateProfileSchema.parse({ fullName: "A", sidebarColor: null }).sidebarColor).toBe(null);
    expect(UpdateProfileSchema.parse({ fullName: "A" }).sidebarColor).toBeUndefined();
  });

  it("rejects an unknown sidebar key", () => {
    expect(UpdateProfileSchema.safeParse({ fullName: "A", sidebarColor: "neon" }).success).toBe(false);
  });
});
