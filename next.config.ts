import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,

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
