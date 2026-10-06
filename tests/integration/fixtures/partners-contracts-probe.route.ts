import { NextResponse, type NextRequest } from "next/server";

import { resolveAccess } from "@/lib/auth";
import { statusForCode, type ServiceResult } from "@/lib/services/types";
import { createContract, type ContractRow } from "@/lib/services/contracts";
import { createPartner, searchPartners, type PartnerRow } from "@/lib/services/partners";

/**
 * TEST FIXTURE — not part of the application.
 *
 * `createPartner()` and `createContract()` are server-side services that
 * read the session from cookies and are normally called as server actions.
 * The round 4 "delete with contracts" integration test needs a way to
 * create a partner + a contract from inside a Vitest process, which is
 * exactly what this probe forwards.
 *
 * Same forwarding contract as the other probes: no role check at the
 * route, no org override from the body. The service decides.
 *
 * Lives under `tests/`, is copied into `app/api/partners-contracts-probe/`
 * by `tests/integration/global-setup.ts` for the duration of the run,
 * answers 404 unless `TEST_PROBE=1`, and is never part of a production
 * build.
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

  if (action === "createPartner") {
    const result = await createPartner(body, {
      organizationId: access.user.organizationId,
    });
    return respond(result);
  }

  if (action === "search") {
    const result = await searchPartners(String(body.term ?? ""));
    return respond(result);
  }

  if (action === "createContract") {
    const result = await createContract(
      body as Parameters<typeof createContract>[0],
      {
        userId: access.user.id,
        organizationId: access.user.organizationId,
      },
    );
    return respond(result);
  }

  return NextResponse.json({ error: "unknown action" }, { status: 404 });
}

// Force the unused-import linter to keep `ContractRow` / `PartnerRow`
// available at runtime; some probe callers will destructure them.
export type { ContractRow, PartnerRow };
