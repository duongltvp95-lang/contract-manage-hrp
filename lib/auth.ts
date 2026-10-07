import "server-only";

import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";

/**
 * Session + access helpers.
 *
 * Wave 1 rules:
 * - docs/plan/wave1-plan-v1.1.md section 28: a request without a Supabase
 *   session must never render an application route.
 * - Owner decision (M3): an account whose `profiles.is_active` is false is
 *   refused too, even though its Supabase session is still valid.
 *
 * `proxy.ts` already enforces both rules for every protected path. These
 * helpers are the in-page / in-route equivalent, and they are what supplies the
 * authoritative `organizationId` to the service layer — the client never gets
 * to name its own organization.
 */

export type CurrentUser = {
  id: string;
  email: string | null;
  fullName: string | null;
  organizationId: string;
  role: "admin" | "user";
  accentColor: string | null;
  backgroundColor: string | null;
  sidebarColor: string | null;
};

export type AccessResult =
  | { status: "ok"; user: CurrentUser }
  | { status: "unauthenticated" }
  | { status: "disabled" };

type ProfileRow = {
  id: string;
  organization_id: string;
  full_name: string | null;
  role: string;
  is_active: boolean;
  accent_color: string | null;
  background_color: string | null;
  sidebar_color: string | null;
};

/**
 * Single source of truth for "who is calling, and may they?".
 *
 * Route handlers should use this so they can answer 401 / 403 instead of an
 * HTML redirect, which is what a page-level guard would produce.
 */
export async function resolveAccess(): Promise<AccessResult> {
  if (!hasEnvVars) {
    return { status: "unauthenticated" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { status: "unauthenticated" };
  }

  // RLS already limits this to the signed-in user's own row.
  const { data } = await supabase
    .from("profiles")
    .select("id, organization_id, full_name, role, is_active, accent_color, background_color, sidebar_color")
    .eq("id", user.id)
    .maybeSingle();

  const profile = data as ProfileRow | null;

  // Either the profile is missing (should be impossible — the
  // on_auth_user_created trigger guarantees one) or an administrator
  // deactivated the account.
  if (!profile || !profile.is_active) {
    return { status: "disabled" };
  }

  return {
    status: "ok",
    user: {
      id: user.id,
      email: user.email ?? null,
      fullName: profile.full_name,
      organizationId: profile.organization_id,
      role: profile.role === "admin" ? "admin" : "user",
      accentColor: profile.accent_color ?? null,
      backgroundColor: profile.background_color ?? null,
      sidebarColor: profile.sidebar_color ?? null,
    },
  };
}

/** Convenience wrapper for code that only needs "is there a usable user?". */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const result = await resolveAccess();
  return result.status === "ok" ? result.user : null;
}

/**
 * Page-level guard. Redirects to /auth/disabled when the account is
 * deactivated, so the user gets an explanation instead of a login loop.
 *
 * Callers must render this behind a <Suspense> boundary because
 * `cacheComponents: true` (next.config.ts) requires dynamic data access to be
 * inside one.
 */
export async function requireUser(): Promise<CurrentUser> {
  const result = await resolveAccess();

  if (result.status === "ok") {
    return result.user;
  }

  redirect(result.status === "disabled" ? "/auth/disabled" : "/login");
}
