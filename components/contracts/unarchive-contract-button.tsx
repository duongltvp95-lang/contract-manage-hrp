"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { unarchiveContractAction } from "@/app/(app)/contracts/actions";
import { Button } from "@/components/ui/button";

/**
 * Round 19 — "Bỏ lưu trữ" on the contract detail (delete-admin emails only).
 */
export function UnarchiveContractButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await unarchiveContractAction(contractId);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success("Đã bỏ lưu trữ");
    router.refresh();
  }

  return (
    <Button
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={run}
      data-testid="contract-unarchive"
    >
      Bỏ lưu trữ
    </Button>
  );
}
