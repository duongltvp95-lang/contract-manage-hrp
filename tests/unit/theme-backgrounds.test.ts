import { describe, expect, it } from "vitest";

import { BACKGROUND_PRESETS, backgroundPreset } from "@/lib/theme-backgrounds";
import { BACKGROUND_KEYS } from "@schemas/theme";
import { UpdateProfileSchema } from "@schemas/profile";

/**
 * Round 13, part 1 — background presets + schema.
 */

const HSL_RE = /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/;

describe("BACKGROUND_PRESETS", () => {
  it("declares exactly six presets with a Vietnamese label", () => {
    expect(Object.keys(BACKGROUND_PRESETS).sort()).toEqual(
      ["default", "gray", "blue", "green", "cream", "pink"].sort(),
    );
    for (const key of BACKGROUND_KEYS) {
      expect(BACKGROUND_PRESETS[key].key).toBe(key);
      expect(BACKGROUND_PRESETS[key].label).toBeTruthy();
    }
  });

  it("uses valid HSL for every light and dark background", () => {
    for (const preset of Object.values(BACKGROUND_PRESETS)) {
      expect(HSL_RE.test(preset.light.background)).toBe(true);
      expect(HSL_RE.test(preset.dark.background)).toBe(true);
    }
  });

  it("copies the project's CURRENT --background values exactly for the default preset", () => {
    // Hardcoded constants (not read from the CSS file): the current
    // `app/globals.css` :root / .dark `--background`.
    expect(BACKGROUND_PRESETS.default.light.background).toBe("0 0% 100%");
    expect(BACKGROUND_PRESETS.default.dark.background).toBe("0 0% 3.9%");
  });

  it("keeps every colored preset readable (high lightness light / low lightness dark)", () => {
    for (const key of ["gray", "blue", "green", "cream", "pink"] as const) {
      const light = parseFloat(BACKGROUND_PRESETS[key].light.background.split(" ")[2]);
      const dark = parseFloat(BACKGROUND_PRESETS[key].dark.background.split(" ")[2]);
      expect(light).toBeGreaterThanOrEqual(90);
      expect(dark).toBeLessThanOrEqual(20);
    }
  });
});

describe("backgroundPreset", () => {
  it("returns the preset for a valid key", () => {
    expect(backgroundPreset("cream")?.key).toBe("cream");
    expect(backgroundPreset("default")?.key).toBe("default");
  });

  it("returns null for an unknown or missing key (caller falls back to default)", () => {
    expect(backgroundPreset("hotpink")).toBeNull();
    expect(backgroundPreset(null)).toBeNull();
    expect(backgroundPreset(undefined)).toBeNull();
    expect(backgroundPreset("")).toBeNull();
  });
});

describe("UpdateProfileSchema.backgroundColor", () => {
  it("accepts a valid key, null, or an omitted value", () => {
    expect(UpdateProfileSchema.parse({ fullName: "A", backgroundColor: "cream" }).backgroundColor).toBe("cream");
    expect(UpdateProfileSchema.parse({ fullName: "A", backgroundColor: null }).backgroundColor).toBe(null);
    expect(UpdateProfileSchema.parse({ fullName: "A" }).backgroundColor).toBeUndefined();
  });

  it("rejects an unknown background key", () => {
    expect(UpdateProfileSchema.safeParse({ fullName: "A", backgroundColor: "neon" }).success).toBe(false);
  });
});
