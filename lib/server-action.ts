import "server-only";

import { resolveAccess, type CurrentUser } from "@/lib/auth";
import type { ServiceIssue, ServiceResult } from "@/lib/services/types";

/**
 * The shared preamble for every server action — plan section 64.
 *
 * A server action is a public endpoint: anything it needs to trust must come
 * from the session, never from its arguments. `authorized()` is the single place
 * that resolves the caller, so no action can forget the check.
 */

export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; message: string; issues?: ServiceIssue[] };

export type AccessDenied = { ok: false; result: ActionResult<never> };

/**
 * Resolves the caller. On failure the action returns the ready-made result
 * rather than inventing its own message, so "disabled" and "signed out" stay
 * distinguishable everywhere.
 */
export async function authorized(): Promise<
  { ok: true; user: CurrentUser } | AccessDenied
> {
  const access = await resolveAccess();

  if (access.status === "ok") {
    return { ok: true, user: access.user };
  }

  return {
    ok: false,
    result: {
      ok: false,
      code: access.status === "disabled" ? "forbidden" : "unauthenticated",
      message:
        access.status === "disabled"
          ? "Tài khoản đã bị vô hiệu hoá"
          : "Bạn cần đăng nhập",
    },
  };
}

/** Lifts a service result into an action result without losing the issue list. */
export function fromService<T>(result: ServiceResult<T>): ActionResult<T> {
  if (result.ok) {
    return { ok: true, data: result.data };
  }

  return {
    ok: false,
    code: result.code,
    message: result.message,
    issues: result.issues,
  };
}

/** Validation failures carry per-field issues so the form can highlight them. */
export function validationFailure(
  message: string,
  issues: ServiceIssue[],
): ActionResult<never> {
  return { ok: false, code: "validation", message, issues };
}
