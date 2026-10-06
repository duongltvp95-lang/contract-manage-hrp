import { NextResponse, type NextRequest } from "next/server";

import { resolveAccess } from "@/lib/auth";
import { statusForCode, type ServiceResult } from "@/lib/services/types";
import {
  createUser,
  deleteUser,
  listUsers,
  updateUser,
} from "@/lib/services/users";

/**
 * TEST FIXTURE — not part of the application.
 *
 * `createUser()`, `listUsers()`, `updateUser()`, and `deleteUser()` read the
 * session from cookies and are invoked from the browser as server actions, so
 * a Vitest process cannot call them directly. This route gives the integration
 * suite a way in.
 *
 * What it deliberately does NOT do is check the role itself: it forwards to
 * the service and returns whatever the service decided. That is the point —
 * the suite asserts that a non-administrator is refused by the service, and a
 * probe that pre-filtered would hide a regression.
 *
 * The organization always comes from the session, exactly as the real action
 * does; nothing in the request body can choose a tenant.
 *
 * Lives under `tests/`, is copied into `app/api/users-actions-probe/` by
 * `tests/integration/global-setup.ts` for the duration of the run, answers 404
 * unless `TEST_PROBE=1`, and is never part of a production build.
 *
 * Round 4, part 1 — extends the round-3 fixture (which had `list`,
 * `create`, `update`) with `delete`. The round 3 promise "the app
 * intentionally has no delete-user action" was reversed by the owner; the
 * route comes back with the same forwarding contract.
 */

function respond<T>(result: ServiceResult<T>) {
  return result.ok
    ? NextResponse.json(result.data, { status: 200 })
    : NextResponse.json(
        { error: result.message, code: result.code, issues: result.issues },
        { status: statusForCode(result.code) },
      );
}

export async function POST(request: NextRequest) {
  if (process.env.TEST_PROBE !== "1" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "");

  const access = await resolveAccess();
  if (access.status !== "ok") {
    return NextResponse.json(
      { error: "unauthenticated", code: "unauthenticated" },
      { status: 401 },
    );
  }

  if (action === "list") {
    return respond(
      await listUsers({ organizationId: access.user.organizationId }),
    );
  }

  if (action === "create") {
    return respond(
      await createUser({
        organizationId: access.user.organizationId,
        email: String(body.email ?? ""),
        fullName: String(body.fullName ?? ""),
        role: body.role === "admin" ? "admin" : "user",
      }),
    );
  }

  if (action === "update") {
    const update = await updateUser(
      {
        userId: String(body.userId ?? ""),
        role: body.role === "admin" || body.role === "user" ? body.role : undefined,
        isActive: typeof body.isActive === "boolean" ? body.isActive : undefined,
      },
      access.user.id,
    );
    return respond(update);
  }

  if (action === "delete") {
    const remove = await deleteUser(
      {
        userId: String(body.userId ?? ""),
        confirmEmail: String(body.confirmEmail ?? ""),
      },
      access.user.id,
    );
    return respond(remove);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 404 });
}
