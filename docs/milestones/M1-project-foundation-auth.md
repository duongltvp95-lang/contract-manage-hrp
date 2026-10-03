# M1 — Project Foundation & Auth (Wave 1)

Task range: `W1-WEB-001` → `W1-WEB-004` (plan section 88).
Master plan: [`docs/plan/wave1-plan-v1.1.md`](../plan/wave1-plan-v1.1.md).

## Reuse / Custom declaration (plan section 87)

```text
W1-WEB-001  Initialize from base repo

Reuse:
  Barty-Bart/nextjs-supabase-shadcn-boilerplate
  Next.js App Router + TypeScript + Tailwind setup
  shadcn/ui component set (components/ui/*)
  Supabase browser / server / proxy clients (lib/supabase/*)
  Auth flows (app/auth/*, components/*-form.tsx)
  Protected sidebar layout (app/dashboard/layout.tsx)

Custom:
  rename app -> contract-manager
  remove demo code

W1-WEB-002  Clean boilerplate

Reuse:
  base repo layout, auth system, Supabase clients  (kept verbatim)

Custom:
  delete dead/demo files only

W1-WEB-003  Configure Supabase

Reuse:
  base repo Supabase integration (createBrowserClient / createServerClient)

Custom:
  env var naming aligned to plan section 83
  (NEXT_PUBLIC_SUPABASE_ANON_KEY instead of NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)

W1-WEB-004  Application shell

Reuse:
  base repo sidebar (components/ui/sidebar.tsx)
  shadcn navigation primitives + DropdownMenu
  lucide-react icons
  next-themes + reused ThemeSwitcher

Custom:
  navigation items reduced to the 3 Wave 1 entries
```

## What was reused

- **Entire base repository**, imported as the project starting point (no
  `create-next-app`, no rewrite).
- **Supabase clients**: `lib/supabase/client.ts`, `lib/supabase/server.ts`,
  `lib/supabase/proxy.ts` — logic untouched; only the env var name changed.
- **Auth system**: `components/login-form.tsx`, `logout-button.tsx`,
  `forgot-password-form.tsx`, `sign-up-form.tsx`, `update-password-form.tsx`
  and `app/auth/{confirm,error,forgot-password,sign-up,sign-up-success,update-password}`
  are unmodified apart from a one-line login URL.
- **Sidebar framework**: `components/ui/sidebar.tsx` and its provider/trigger.
- **shadcn/ui**: Button, Card, Input, Label, DropdownMenu, Sheet, Skeleton,
  Tooltip, Separator, Badge, Checkbox — all kept.
- **lucide-react** for all navigation icons.
- **next-themes** `ThemeProvider` + the previously unused `ThemeSwitcher`,
  now wired into the sidebar footer.
- **`hasEnvVars`** helper from `lib/utils.ts`.

## What was custom

- `package.json`: name `contract-manager`, added `pnpm typecheck`, pinned the
  dependencies the boilerplate had left as `latest`.
- App renamed in `app/layout.tsx` metadata and `README.md`.
- `.env.example` rewritten with the three Supabase variables plus the R2 /
  upload variables from plan section 83.
- `.npmrc` with `node-linker=hoisted` (see "Deviations").
- `app/(app)/` route group holding the authenticated shell:
  `layout.tsx`, `dashboard/page.tsx`, `contracts/page.tsx`, `settings/page.tsx`.
- `app/login/page.tsx` — the canonical login route (renders the reused
  `LoginForm`).
- `lib/auth.ts` — `requireUser()`, the only new authorization glue.
- `components/app-sidebar.tsx` — navigation reduced to 3 items, `next/link`
  instead of raw anchors, active-state highlighting, real user email,
  demo footer entries removed.
- Demo/dead code deleted: `app/dashboard/` (moved), `app/auth/login/` (moved to
  `/login`), `components/auth-button.tsx`, boilerplate OG/Twitter images.

## Acceptance criteria

| Criterion | Status |
| --- | --- |
| `pnpm dev` runs without errors | see Verification |
| `pnpm build` succeeds | see Verification |
| Email + password login / logout works | ✅ verified end-to-end against the live Supabase project |
| Sidebar shows exactly Dashboard / Contracts / Settings | done |
| Demo code removed, auth/layout/Supabase clients intact | done |
| Protected routes redirect to `/login` | done (proxy + `requireUser()`) |

## Commands

```bash
pnpm install
pnpm dev          # dev server on http://localhost:3000
pnpm build        # production build
pnpm start        # serve production build
pnpm lint
pnpm typecheck
```

## Verification

Environment: Windows, Node v24.9.0, pnpm 10.34.5, Next.js 16.3.8 (Turbopack),
`cacheComponents: true`.

```text
pnpm typecheck   PASS (tsc --noEmit, no output)
pnpm lint        PASS (eslint ., exit 0)
pnpm build       PASS (exit 0)
pnpm dev         PASS ("Ready in 453ms", http://localhost:3000)
```

`pnpm build` route output:

```text
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /auth/confirm
├ ◐ /auth/error
├ ○ /auth/forgot-password
├ ○ /auth/sign-up
├ ○ /auth/sign-up-success
├ ○ /auth/update-password
├ ○ /contracts
├ ○ /dashboard
├ ○ /login
└ ○ /settings

ƒ Proxy (Middleware)
```

Route protection, measured against the running dev server with a temporary
`.env.local` (valid-format URL pointing at a closed port, so no session can
exist):

```text
/                        -> 307  http://localhost:3000/login
/dashboard               -> 307  http://localhost:3000/login
/contracts               -> 307  http://localhost:3000/login
/settings                -> 307  http://localhost:3000/login
/login                   -> 200
/auth/forgot-password    -> 200
```

`/login` HTML contains the reused login form (Email / Password fields).
`components/app-sidebar.tsx` declares exactly three navigation entries and no
other file in `app/` or `components/` references Processing, Review, AI or
Partners.

### Supabase project verification (real credentials, `.env.local`)

SDK versions in use — **both already the newest published**:

| Package | Installed | Latest on npm | Action |
| --- | --- | --- | --- |
| `@supabase/supabase-js` | 2.117.2 | 2.117.2 | none needed |
| `@supabase/ssr` | 0.12.7 | 0.12.7 (`@supabase/ssr` has no v2 line) | none needed |

The project uses the **new key format**:

```text
NEXT_PUBLIC_SUPABASE_ANON_KEY   sb_publishable_…   (browser-safe)
SUPABASE_SERVICE_ROLE_KEY       sb_secret_…        (server-only)
```

Probe against the live project, run through the project's own installed SDK:

```text
[1] anon getClaims()          ok, claims=null            -> sb_publishable_ key accepted
[2] signInWithPassword(bogus) invalid_credentials (400)  -> URL + key valid, Email provider ENABLED
[3] admin listUsers()         ok, total users = 0        -> sb_secret_ key valid server-side
```

`[2]` is the decisive result: an API-key or provider problem returns a different
error (`Invalid API key`, `Email logins are disabled`); `invalid_credentials`
means Supabase reached the credential check.

Application routes served by `next dev` with the real `.env.local`:

```text
/                -> 307 → /login
/dashboard       -> 307 → /login
/contracts       -> 307 → /login
/settings        -> 307 → /login
/login           -> 200 (reused LoginForm: Email, Password fields)
/auth/sign-up    -> 200
```

Secret containment, checked against the production build output:

```text
sb_secret_     in .next/static (client bundles) : 0 files
sb_secret_     in .next/server (server bundles) : 0 files
sb_publishable_ in .next/static (client bundles): 1 file (expected — NEXT_PUBLIC_*)
```

The secret key never reaches the browser bundle, and is not even inlined into
the server bundle (it is read from `process.env` at runtime).
`.env.local` is covered by three `.gitignore` rules (`.env*.local`, `.env`,
`.env.local`).

### Live login / logout — verified end-to-end

A confirmed test user was created through the Admin API
(`email_confirm: true`, so no dashboard setting had to change), then the real
Supabase SSR session flow was driven and the resulting cookies were sent to the
running dev server:

```text
[1] create confirmed test user : PASS (m1.test@hrpartner.vn)
[2] signInWithPassword         : PASS (user 276efa07…)
[3] session cookies written    : PASS (sb-vohrerrbthbrkwjllnlj-auth-token)
[4] GET /dashboard (logged in) : PASS status=200
[5] page shows session user    : PASS      <- requireUser() returned the real user
[6] /contracts, /settings      : PASS (200, 200)
[7] signOut                    : PASS
[8] session cookies cleared    : PASS (remaining: none)
[9] GET /dashboard (logged out): PASS status=307 -> /login
```

`[5]` is the strongest result: the session established at sign-in reaches the
Server Component through `lib/supabase/server.ts` and `requireUser()`, so route
protection and the session plumbing are both exercised for real.

### Test account

```text
email    : m1.test@hrpartner.vn
password : M1-G6D2MHx7AVxY!aA1
role     : none assigned in the database yet (profiles table lands in W1-WEB-006)
```

This account exists only to verify M1. **Rotate or delete it before production**
— it has a password that has been written into this document.

## Deviations from the plan

1. **`git` is unavailable in this environment**, so the base repository was
   imported from the GitHub `main` tarball instead of `git clone` / fork. The
   working tree is byte-identical to the base repo; only VCS history is absent.
2. **Flat repository layout at the root**, not the `apps/web` + `packages/*`
   monorepo of plan section 25. Confirmed with T1: keeping the base repo layout
   maximises reuse in M1; the monorepo move is deferred.
3. **`.npmrc` → `node-linker=hoisted`.** pnpm's default isolated linker breaks
   Next.js 16 on Windows: the Next require hook resolves `@swc/helpers` through
   `node_modules/next/...` lexical paths, which do not exist under the
   junction/symlink layout. Without this, `next build` fails with
   `Could not find the Next.js package (next/package.json)` and
   `Cannot find module '@swc/helpers/_/_interop_require_default'`.
4. **`.env.example` uses `NEXT_PUBLIC_SUPABASE_ANON_KEY`** (plan section 83).
   The base repo was internally inconsistent: `lib/utils.ts` already read
   `NEXT_PUBLIC_SUPABASE_ANON_KEY` while the clients read
   `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, so `hasEnvVars` never matched the
   clients. Both now agree on the plan's variable name.
5. **`package-lock.json` removed**; pnpm is the package manager (plan
   section 85 uses `pnpm`). `pnpm-lock.yaml` is now the lockfile.
6. **`/auth/login` removed** in favour of `/login` (plan section 27). The rest
   of `app/auth/*` is kept so email confirmation and password reset still work.
7. **`eslint-config-next` moved 15.3.1 → 16.3.8** to match Next 16, and
   `eslint.config.mjs` rewritten as a native flat config. The boilerplate's
   `FlatCompat` / `compat.extends("next/core-web-vitals")` form fails on ESLint 9
   with `TypeError: Converting circular structure to JSON`, so `pnpm lint` never
   worked in the base repo. eslint-config-next 16 also enables the React
   Compiler rules, which flag four inherited files (`components/ui/sidebar.tsx`,
   `hooks/use-mobile.tsx`, `components/theme-switcher.tsx`, `tailwind.config.ts`).
   Those rules are switched off for exactly those paths rather than editing
   reused code; application code keeps the full rule set.
8. **`lib/supabase/proxy.ts`: the `pathname !== "/"` exception was removed.**
   With it, an unauthenticated `/` returned `200` plus a client-side
   meta-refresh; without it the middleware answers `307 → /login` like every
   other protected route. `/` for a signed-in user still resolves to
   `/dashboard` inside the page.

## Follow-ups for the next milestone

### Blocking M1 sign-off

- None. All five Definition-of-Done criteria are met.

### Before production

- Rotate or delete the `m1.test@hrpartner.vn` test account (password is in this
  document).
- Rotate the Supabase `sb_secret_` key if it is ever exposed beyond `.env.local`.

### Supabase Dashboard settings (cannot be done from the repository)

- Authentication → Providers → **Email: enabled** — already confirmed enabled by
  probe `[2]`.
- Authentication → URL Configuration:
  - Site URL = `https://cm.hrpartner.vn`
  - Redirect URLs = `http://localhost:3000/**` and `https://cm.hrpartner.vn/**`
- If local login stalls on "Confirm email", either confirm the test user or
  temporarily disable that setting.

### Deployment

- `APP_URL=https://cm.hrpartner.vn` on Vercel; `http://localhost:3000` locally.
  `APP_URL` is declared in `.env.example` but not yet read by any code — nothing
  in M1 needs it.

### Product decisions

- Whether public sign-up (`/auth/sign-up`) stays enabled or users are
  provisioned by an admin only.
- UI language — the reused auth screens are English.
- `app/contracts` and `app/settings` are placeholders; real content lands in
  `W1-WEB-019`+ and `W1-WEB-034`.

### Credentials note

`SUPABASE_SERVICE_ROLE_KEY` is the new `sb_secret_…` key. The legacy
`service_role` JWT found alongside it is stored **commented out** in
`.env.local` as
`# SUPABASE_SERVICE_ROLE_KEY_LEGACY=…` in case the new key ever misbehaves. No
code reads it in M1.
