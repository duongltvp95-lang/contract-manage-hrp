import { describe, expect, it } from "vitest";

import { ACCENT_PRESETS, accentPreset } from "@/lib/theme-accents";
import { ACCENT_KEYS } from "@schemas/theme";
import { UpdateProfileSchema } from "@schemas/profile";

/**
 * Round 12, part 1 — accent presets + schema.
 */

const HSL_RE = /^\d+(\.\d+)? \d+(\.\d+)?% \d+(\.\d+)?%$/;

describe("ACCENT_PRESETS", () => {
  it("declares exactly six presets with a Vietnamese label", () => {
    expect(Object.keys(ACCENT_PRESETS).sort()).toEqual(
      ["blue", "green", "rose", "violet", "orange", "teal"].sort(),
    );
    for (const key of ACCENT_KEYS) {
      expect(ACCENT_PRESETS[key].key).toBe(key);
      expect(ACCENT_PRESETS[key].label).toBeTruthy();
    }
  });

  it("uses valid HSL for every light and dark color", () => {
    for (const preset of Object.values(ACCENT_PRESETS)) {
      expect(HSL_RE.test(preset.light.primary)).toBe(true);
      expect(HSL_RE.test(preset.light.primaryForeground)).toBe(true);
      expect(HSL_RE.test(preset.dark.primary)).toBe(true);
      expect(HSL_RE.test(preset.dark.primaryForeground)).toBe(true);
    }
  });

  it("copies the project's CURRENT --primary values exactly for the blue preset", () => {
    // The values below are the current `app/globals.css` :root / .dark `--primary`
    // and `--primary-foreground`. Compared as hardcoded constants (not read from
    // the CSS file) so a rename of the file cannot silently change this test.
    expect(ACCENT_PRESETS.blue.light).toEqual({
      primary: "0 0% 9%",
      primaryForeground: "0 0% 98%",
    });
    expect(ACCENT_PRESETS.blue.dark).toEqual({
      primary: "0 0% 98%",
      primaryForeground: "0 0% 9%",
    });
  });

  it("gives every colored preset a readable foreground (near-white light / near-black dark)", () => {
    for (const key of ["green", "rose", "violet", "orange", "teal"] as const) {
      const preset = ACCENT_PRESETS[key];
      expect(preset.light.primaryForeground).toBe("0 0% 100%");
      expect(preset.dark.primaryForeground).toBe("0 0% 9%");
    }
  });
});

describe("accentPreset", () => {
  it("returns the preset for a valid key", () => {
    expect(accentPreset("teal")?.key).toBe("teal");
    expect(accentPreset("blue")?.key).toBe("blue");
  });

  it("returns null for an unknown or missing key (caller falls back to blue)", () => {
    expect(accentPreset("hotpink")).toBeNull();
    expect(accentPreset(null)).toBeNull();
    expect(accentPreset(undefined)).toBeNull();
    expect(accentPreset("")).toBeNull();
  });
});

describe("UpdateProfileSchema.accentColor", () => {
  it("accepts a valid accent key, null, or an omitted value", () => {
    expect(UpdateProfileSchema.parse({ fullName: "A", accentColor: "teal" }).accentColor).toBe("teal");
    expect(UpdateProfileSchema.parse({ fullName: "A", accentColor: null }).accentColor).toBe(null);
    expect(UpdateProfileSchema.parse({ fullName: "A" }).accentColor).toBeUndefined();
  });

  it("rejects an unknown accent key", () => {
    expect(UpdateProfileSchema.safeParse({ fullName: "A", accentColor: "hotpink" }).success).toBe(false);
  });
});
