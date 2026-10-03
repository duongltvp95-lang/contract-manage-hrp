/**
 * Presigned view URLs — client side (plan sections 59, 60).
 *
 * The browser never builds an R2 URL itself: it asks `/api/files/view-url`,
 * which authorizes the request and only then signs. This module holds the pure
 * refresh policy plus the fetch, so the policy can be tested without a browser.
 *
 * Client-only: `requestViewUrl` uses a relative `fetch`, so do not import it
 * from a Server Component.
 */

export type ViewUrl = {
  fileId: string;
  objectKey: string;
  viewUrl: string;
  expiresInSeconds: number;
  expiresAt: string;
};

/**
 * Refresh this long before the signature actually dies, so a slow first byte
 * never races the expiry. Plan section 60 allows a 5-15 minute window; the
 * server issues 15.
 */
export const REFRESH_MARGIN_MS = 60_000;

/** Smallest delay we will schedule, so a clock skew cannot spin the timer. */
export const MIN_REFRESH_DELAY_MS = 5_000;

/**
 * Pure: should a new URL be minted at `now`?
 *
 * True when there is no URL, when the timestamp is unparseable, or when the
 * margin has been reached.
 */
export function shouldRefresh(
  expiresAt: string | null | undefined,
  now: number = Date.now(),
): boolean {
  if (!expiresAt) return true;
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return true;
  return now >= expiry - REFRESH_MARGIN_MS;
}

/** How long until the proactive refresh should fire. */
export function msUntilRefresh(
  expiresAt: string,
  now: number = Date.now(),
): number {
  const expiry = Date.parse(expiresAt);
  if (Number.isNaN(expiry)) return MIN_REFRESH_DELAY_MS;
  return Math.max(MIN_REFRESH_DELAY_MS, expiry - REFRESH_MARGIN_MS - now);
}

export async function requestViewUrl(
  fileId: string,
  signal?: AbortSignal,
): Promise<ViewUrl> {
  const response = await fetch("/api/files/view-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fileId }),
    signal,
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(
      payload?.error ?? `Không lấy được đường dẫn xem tệp (HTTP ${response.status})`,
    );
  }

  return (await response.json()) as ViewUrl;
}

export function isImageMime(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

export function isPdfMime(mimeType: string): boolean {
  return mimeType === "application/pdf";
}
