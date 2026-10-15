import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Whitelist nguồn kết nối cho Development (Supabase CLI local, HMR websockets)
const localConnectOrigins = isDev
  ? " http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*"
  : "";
const localImgOrigins = isDev ? " http://localhost:* http://127.0.0.1:*" : "";

/**
 * Chính sách script-src:
 * - 'unsafe-eval': Chỉ cho phép trong Development (cần thiết cho Turbopack HMR / Fast Refresh và sourcemaps).
 *   Ở Production, loại bỏ 'unsafe-eval' để chặn hoàn toàn các vector tấn công eval-based XSS.
 * - 'unsafe-inline': Cần thiết cho Next.js App Router chèn inline hydration data / RSC payload script.
 */
const scriptSrcDirective = isDev
  ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
  : "script-src 'self' 'unsafe-inline'";

const cspHeaderValue = [
  "default-src 'self'",
  scriptSrcDirective,
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com data:",
  `img-src 'self' data: blob: https://*.supabase.co https://*.r2.cloudflarestorage.com${localImgOrigins}`,
  `connect-src 'self' https://*.supabase.co https://*.r2.cloudflarestorage.com wss://*.supabase.co${localConnectOrigins}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const nextConfig: NextConfig = {
  cacheComponents: true,

  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
      allowedOrigins: [
        "cm.hrpartner.vn",
        "*.hrpartner.vn",
        "contract-manage-hrp.vercel.app",
        "*.vercel.app",
        "localhost:3000",
      ],
    },
  },

  /**
   * Cấu hình Security Headers & Content-Security-Policy (CSP) — P1
   * Bảo vệ ứng dụng chống XSS, clickjacking, MIME sniffing và rò rỉ dữ liệu.
   */
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            key: "X-XSS-Protection",
            value: "1; mode=block",
          },
          {
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: cspHeaderValue,
          },
        ],
      },
    ];
  },

  /**
   * Next 16 allows only one `next dev` per project directory, keyed on the build
   * directory rather than the port — a second server on another port exits with
   * "Another next dev server is already running".
   *
   * The integration suite needs its own server (the route handlers have to run
   * for real), so it sets `NEXT_DIST_DIR=.next-test` and gets an independent
   * instance instead of fighting a developer's dev server on 3000. Unset in
   * normal use, so nothing changes for `pnpm dev` / `pnpm build`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
