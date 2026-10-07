import { z } from "zod";

/**
 * Accent preset keys — round 12, part 1.
 *
 * Shared by the schema (`UpdateProfileSchema.accentColor`) and the theme engine
 * (`lib/theme-accents.ts`) so both sides use the exact same enum. `blue` is the
 * default and matches the project's current `--primary` values.
 */

export const ACCENT_KEYS = [
  "blue",
  "green",
  "rose",
  "violet",
  "orange",
  "teal",
] as const;

export type AccentKey = (typeof ACCENT_KEYS)[number];

export const AccentKeySchema = z.enum(ACCENT_KEYS);
