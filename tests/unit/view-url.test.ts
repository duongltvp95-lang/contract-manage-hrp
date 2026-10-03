import { describe, expect, it } from "vitest";

import {
  MIN_REFRESH_DELAY_MS,
  REFRESH_MARGIN_MS,
  isImageMime,
  isPdfMime,
  msUntilRefresh,
  shouldRefresh,
} from "@/lib/view-url";

/**
 * W1-WEB-030 — signed URL refresh policy (plan section 60).
 *
 * Pure, so the policy is checked without a browser or a clock. The real viewer
 * uses exactly these functions.
 */

const now = Date.UTC(2026, 9, 3, 8, 0, 0);
const at = (msFromNow: number) => new Date(now + msFromNow).toISOString();

describe("shouldRefresh", () => {
  it("refreshes when there is no URL or an unparseable timestamp", () => {
    expect(shouldRefresh(null, now)).toBe(true);
    expect(shouldRefresh(undefined, now)).toBe(true);
    expect(shouldRefresh("", now)).toBe(true);
    expect(shouldRefresh("not-a-date", now)).toBe(true);
  });

  it("does not refresh a URL that is comfortably valid", () => {
    expect(shouldRefresh(at(10 * 60_000), now)).toBe(false);
  });

  it("refreshes inside the safety margin, not only at expiry", () => {
    expect(shouldRefresh(at(REFRESH_MARGIN_MS + 1_000), now)).toBe(false);
    expect(shouldRefresh(at(REFRESH_MARGIN_MS - 1_000), now)).toBe(true);
  });

  it("refreshes an already-expired URL", () => {
    expect(shouldRefresh(at(-1_000), now)).toBe(true);
  });
});

describe("msUntilRefresh", () => {
  it("targets the margin, not the expiry", () => {
    expect(msUntilRefresh(at(15 * 60_000), now)).toBe(15 * 60_000 - REFRESH_MARGIN_MS);
  });

  it("never schedules below the floor, so a clock skew cannot spin the timer", () => {
    expect(msUntilRefresh(at(100), now)).toBe(MIN_REFRESH_DELAY_MS);
    expect(msUntilRefresh(at(-60_000), now)).toBe(MIN_REFRESH_DELAY_MS);
    expect(msUntilRefresh("nonsense", now)).toBe(MIN_REFRESH_DELAY_MS);
  });

  it("is consistent with shouldRefresh at the boundary", () => {
    const expiresAt = at(REFRESH_MARGIN_MS);
    expect(shouldRefresh(expiresAt, now)).toBe(true);
    expect(msUntilRefresh(expiresAt, now)).toBe(MIN_REFRESH_DELAY_MS);
  });
});

describe("mime helpers", () => {
  it("routes PDFs to the PDF viewer", () => {
    expect(isPdfMime("application/pdf")).toBe(true);
    expect(isPdfMime("image/png")).toBe(false);
  });

  it("routes images to the image viewer", () => {
    expect(isImageMime("image/png")).toBe(true);
    expect(isImageMime("image/jpeg")).toBe(true);
    expect(isImageMime("application/pdf")).toBe(false);
  });
});
