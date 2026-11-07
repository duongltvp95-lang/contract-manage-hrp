/**
 * Internal post-authentication redirect sanitizer (`A09`).
 *
 * `/auth/confirm` receives a user-controlled `next` query parameter in OTP /
 * password-recovery links. Passing `next` straight to `redirect()` allows Open
 * Redirects via external URLs (`https://evil.example`), protocol-relative URLs
 * (`//evil.example`), backslash variants (`/\evil.example`), or encoded slashes.
 */

const INTERNAL_ORIGIN = "http://hrp.internal";

const ALLOWED_INTERNAL_PREFIXES = [
  "/dashboard",
  "/contracts",
  "/partners",
  "/settings",
  "/admin/logs",
  "/auth/update-password",
  "/auth/mfa",
  "/login",
] as const;

function hasForbiddenCharacters(value: string): boolean {
  return /[\u0000-\u001f\u007f\\]/.test(value);
}

function isAllowedInternalPathname(pathname: string): boolean {
  if (pathname === "/") {
    return true;
  }

  return ALLOWED_INTERNAL_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function sanitizeInternalRedirectPath(
  raw: string | null | undefined,
  fallback = "/dashboard",
): string {
  if (typeof raw !== "string") {
    return fallback;
  }

  if (raw.length === 0 || raw.length > 2_048 || hasForbiddenCharacters(raw)) {
    return fallback;
  }

  const candidate = raw.trim();
  if (
    candidate.length === 0 ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    hasForbiddenCharacters(candidate)
  ) {
    return fallback;
  }

  // Decode up to two percent-encoding passes on the path portion (before ? / #)
  // so encoded protocol-relative or backslash-relative payloads like `/%2f/evil`
  // or `/%5cevil` are rejected before URL normalization.
  const rawPathPortion = candidate.split(/[?#]/, 1)[0] ?? "";
  let decodedPath = rawPathPortion;
  for (let pass = 0; pass < 2; pass += 1) {
    try {
      decodedPath = decodeURIComponent(decodedPath);
    } catch {
      return fallback;
    }
    if (
      !decodedPath.startsWith("/") ||
      decodedPath.startsWith("//") ||
      hasForbiddenCharacters(decodedPath)
    ) {
      return fallback;
    }
    const segments = decodedPath.split("/");
    if (segments.some((segment) => segment === "." || segment === "..")) {
      return fallback;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(candidate, INTERNAL_ORIGIN);
  } catch {
    return fallback;
  }

  if (
    parsed.origin !== INTERNAL_ORIGIN ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    !parsed.pathname.startsWith("/") ||
    parsed.pathname.startsWith("//") ||
    hasForbiddenCharacters(parsed.pathname)
  ) {
    return fallback;
  }

  const normalizedSegments = parsed.pathname.split("/");
  if (normalizedSegments.some((segment) => segment === "." || segment === "..")) {
    return fallback;
  }

  if (!isAllowedInternalPathname(parsed.pathname)) {
    return fallback;
  }

  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
