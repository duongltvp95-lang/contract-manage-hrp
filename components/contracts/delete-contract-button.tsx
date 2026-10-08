"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { deleteContractAction } from "@/app/(app)/contracts/actions";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

/**
 * Round 19 — hard-delete a contract (only rendered for the delete-admin emails).
 *
 * `label` turns the trigger into a "Xoá hợp đồng" danger button (detail page);
 * otherwise it is a small trash icon (table row).
 */
export function DeleteContractButton({
  contractId,
  label,
  onDeleted,
}: {
  contractId: string;
  label?: string;
  onDeleted?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await deleteContractAction(contractId);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success("Đã xoá hợp đồng");
    if (onDeleted) onDeleted();
    else router.refresh();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        {label ? (
          <Button
            variant="destructive"
            size="sm"
            disabled={busy}
            data-testid={`contract-delete-${contractId}`}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            {label}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            data-testid={`contract-delete-${contractId}`}
            aria-label="Xoá hợp đồng"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá hợp đồng này?</AlertDialogTitle>
          <AlertDialogDescription>
            Tệp đính kèm sẽ bị xoá vĩnh viễn. Hành động này không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction onClick={run} data-testid="contract-delete-confirm">
            Xoá
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
