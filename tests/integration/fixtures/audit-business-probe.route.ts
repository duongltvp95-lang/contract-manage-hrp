import { NextResponse, type NextRequest } from "next/server";

import type { CreateContractInput, UpdateContractInput } from "@schemas/contract";
import type { AuditAction } from "@schemas/audit-log";
import type { PartnerStatus } from "@schemas/partner";

import { resolveAccess } from "@/lib/auth";
import { DEFAULT_QUERY, type ContractsQuery } from "@/lib/contracts-query";
import { listAuditLogs } from "@/lib/services/audit-logs";
import { archiveContract, createContract, deleteContract, listContracts, updateContract } from "@/lib/services/contracts";
import {
  getExpiringContracts,
  getRecentContracts,
} from "@/lib/services/dashboard";
import { completeUpload, listContractFiles } from "@/lib/services/files";
import {
  createPartner,
  deletePartner,
  getPartner,
  importPartners,
  listCompanies,
  listPartners,
  searchPartners,
  setPartnerStatus,
  updatePartner,
  type PartnerImportServiceRow,
} from "@/lib/services/partners";
import { updateProfile } from "@/lib/services/profiles";

/**
 * TEST FIXTURE — not part of the application.
 *
 * `recordCurrentUserAudit` attributes a log to the CURRENT session user, so it
 * only works inside a request context (the server actions / routes). This probe
 * gives the round 8 integration suite a route that calls the business services
 * with the request's session, so the audit rows they write can be asserted
 * against the real database.
 *
 * Lives under `tests/`, is copied into `app/api/audit-business-probe/` by
 * `tests/integration/global-setup.ts` for the duration of the run, answers 404
 * unless `TEST_PROBE=1`, and is never part of a production build.
 */

type ProbeBody = {
  action: string;
  payload?: Record<string, unknown>;
};

export async function POST(request: NextRequest) {
  if (process.env.TEST_PROBE !== "1" || process.env.NODE_ENV === "production") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const access = await resolveAccess();
  if (access.status !== "ok") {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as ProbeBody | null;
  const payload = (body?.payload ?? {}) as Record<string, unknown>;
  const organizationId = access.user.organizationId;

  switch (body?.action) {
    case "create_partner":
      return result(await createPartner(payload, { organizationId }));
    case "update_partner":
      return result(
        await updatePartner(String(payload.id ?? ""), payload.input, {
          organizationId,
        }),
      );
    case "import_partners":
      return result(
        await importPartners(
          (payload.rows ?? []) as PartnerImportServiceRow[],
          { organizationId },
        ),
      );
    case "create_contract":
      return result(
        await createContract(payload as CreateContractInput, {
          userId: access.user.id,
          organizationId,
        }),
      );
    case "update_contract":
      return result(
        await updateContract(
          String(payload.id ?? ""),
          (payload.input ?? {}) as UpdateContractInput,
          {
            userId: access.user.id,
            organizationId,
          },
        ),
      );
    case "archive_contract":
      return result(await archiveContract(String(payload.id ?? ""), organizationId));
    case "complete_upload":
      return result(
        await completeUpload({
          organizationId,
          userId: access.user.id,
          contractId: String(payload.contractId ?? ""),
          fileId: String(payload.fileId ?? ""),
          objectKey: String(payload.objectKey ?? ""),
          filename: String(payload.filename ?? ""),
          mimeType: String(payload.mimeType ?? ""),
          fileSize: Number(payload.fileSize ?? 0),
          ...(payload.kind === "appendix" || payload.kind === "document"
            ? { kind: payload.kind }
            : {}),
        }),
      );
    case "list_contract_files":
      return result(
        await listContractFiles(organizationId, String(payload.contractId ?? "")),
      );
    case "list_contracts":
      return result(
        await listContracts({
          organizationId,
          query: {
            ...DEFAULT_QUERY,
            pageSize: 50,
            ...(typeof payload === "object" && payload
              ? (payload as Partial<ContractsQuery>)
              : {}),
          },
        }),
      );
    case "delete_contract":
      return result(await deleteContract(String(payload.id ?? ""), { organizationId }));
    case "delete_partner":
      return result(await deletePartner(String(payload.id ?? ""), { organizationId }));
    case "update_profile":
      return result(await updateProfile(payload, access.user.id));
    case "list_logs":
      return result(
        await listAuditLogs(organizationId, {
          page: 1,
          pageSize: 200,
          ...(typeof payload.action === "string"
            ? { action: payload.action as AuditAction }
            : {}),
        }),
      );
    case "set_partner_status":
      return result(
        await setPartnerStatus(
          String(payload.id ?? ""),
          (payload.status === "stopped" ? "stopped" : "active") as PartnerStatus,
          { organizationId },
        ),
      );
    case "list_partners":
      return result(await listPartners({ organizationId }));
    case "get_partner":
      return result(await getPartner(String(payload.id ?? ""), { organizationId }));
    case "list_companies":
      return result(await listCompanies({ organizationId }));
    case "search_partners":
      return result(await searchPartners(String(payload.term ?? "")));
    case "recent_contracts":
      return result(
        await getRecentContracts(
          organizationId,
          typeof payload.limit === "number" ? payload.limit : 20,
        ),
      );
    case "expiring_contracts":
      return result(
        await getExpiringContracts(
          organizationId,
          new Date(),
          typeof payload.limit === "number" ? payload.limit : 20,
        ),
      );
    default:
      return NextResponse.json(
        { error: "unknown action", code: "unknown_action" },
        { status: 422 },
      );
  }
}

function result(
  service: { ok: boolean; data?: unknown; code?: string; message?: string; issues?: unknown },
) {
  if (service.ok) {
    return NextResponse.json({ ok: true, data: service.data }, { status: 200 });
  }
  return NextResponse.json(
    {
      ok: false,
      code: service.code,
      message: service.message,
      issues: service.issues,
    },
    { status: 200 },
  );
}
