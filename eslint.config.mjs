import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

/**
 * eslint-config-next 16 ships native flat configs. The older
 * `compat.extends("next/core-web-vitals")` bridge throws
 * "Converting circular structure to JSON" under ESLint 9.
 *
 * eslint-config-next 16 also turns on the React Compiler lint rules
 * (`react-hooks/purity`, `react-hooks/set-state-in-effect`). Four files that
 * came verbatim from upstream trip them:
 *   - components/ui/sidebar.tsx   (shadcn/ui: Math.random skeleton width)
 *   - hooks/use-mobile.tsx        (shadcn/ui hook)
 *   - components/theme-switcher.tsx
 *   - tailwind.config.ts          (require() plugin)
 *
 * Wave 1 reuses those files unchanged (plan sections 3, 8, 9), so the rules are
 * relaxed for exactly those paths. Application code keeps the full rule set.
 */
const inheritedFiles = [
  "components/ui/**/*.{ts,tsx}",
  "hooks/use-mobile.tsx",
  "components/theme-switcher.tsx",
  "tailwind.config.ts",
];

/** @type {import("eslint").Linter.Config[]} */
const eslintConfig = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      ".next/**",
      // The test suites build into their own directories (next.config.ts reads
      // NEXT_DIST_DIR) so they never clash with a running dev server. Those are
      // generated bundles, not source, and must not be linted.
      ".next-test/**",
      ".next-e2e/**",
      "node_modules/**",
      "next-env.d.ts",
      ".pnpm-store/**",
      "test-results/**",
      "playwright-report/**",
    ],
  },
  {
    files: inheritedFiles,
    rules: {
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
      "@typescript-eslint/no-require-imports": "off",
    },
  },
];

export default eslintConfig;
