"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { deleteContractsAction } from "@/app/(app)/contracts/actions";
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
 * Round 24 — bulk hard-delete of contracts (delete-admin emails only).
 *
 * One toast for the successes; per-item failures are listed individually so
 * nothing is silently dropped.
 */
export function BulkDeleteContractsButton({
  ids,
  onDone,
}: {
  ids: string[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await deleteContractsAction(ids);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    const { results } = result.data;
    const deleted = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);

    if (deleted > 0) {
      toast.success(`Đã xoá ${deleted} hợp đồng`);
    }
    for (const item of failed.slice(0, 5)) {
      toast.error(item.error ?? "Không xoá được một hợp đồng đã chọn");
    }

    onDone();
    router.refresh();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="destructive"
          size="sm"
          disabled={busy}
          data-testid="bulk-delete-contracts"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Xoá đã chọn ({ids.length})
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá {ids.length} hợp đồng đã chọn?</AlertDialogTitle>
          <AlertDialogDescription>
            Tệp đính kèm sẽ bị xoá vĩnh viễn. Hành động này không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            onClick={run}
            data-testid="bulk-delete-contracts-confirm"
          >
            Xoá
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
