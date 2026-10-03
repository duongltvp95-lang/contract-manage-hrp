import { Suspense } from "react";

import { MAX_UPLOAD_SIZE_MB } from "@schemas/file";

import { ContractForm } from "@/components/contracts/contract-form";
import { requireUser } from "@/lib/auth";

/**
 * Add Contract — plan section 45.
 *
 * The server passes the configured upload limit down, so the dropzone shows the
 * real number instead of the Client Component fallback (see the note in
 * packages/schemas/file.ts).
 */
async function NewContractContent() {
  await requireUser();

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-8">
      <div>
        <h1 className="text-2xl font-bold">Thêm hợp đồng</h1>
        <p className="text-muted-foreground">
          Nhập thông tin hợp đồng và tải tài liệu lên.
        </p>
      </div>

      <ContractForm maxUploadSizeMb={MAX_UPLOAD_SIZE_MB} />
    </div>
  );
}

export default function NewContractPage() {
  return (
    <Suspense
      fallback={<div className="p-8 text-muted-foreground">Đang tải...</div>}
    >
      <NewContractContent />
    </Suspense>
  );
}
