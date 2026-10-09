"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { deletePartnersAction } from "@/app/(app)/partners/actions";
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
 * Round 24 — bulk hard-delete of partners (delete-admin emails only).
 *
 * Per-item failures (e.g. a partner that still has contracts) are listed with
 * the partner's name so the reason is obvious.
 */
export function BulkDeletePartnersButton({
  ids,
  names,
  onDone,
}: {
  ids: string[];
  /** id → display name, for the per-item error lines. */
  names: Map<string, string>;
  onDone: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await deletePartnersAction(ids);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    const { results } = result.data;
    const deleted = results.filter((item) => item.ok).length;
    const failed = results.filter((item) => !item.ok);

    if (deleted > 0) {
      toast.success(`Đã xoá ${deleted} đối tác`);
    }
    for (const item of failed.slice(0, 5)) {
      const name = names.get(item.id);
      const reason = item.error ?? "Không xoá được";
      toast.error(name ? `${name}: ${reason}` : reason);
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
          data-testid="bulk-delete-partners"
        >
          <Trash2 className="mr-1 h-4 w-4" />
          Xoá đã chọn ({ids.length})
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá {ids.length} đối tác đã chọn?</AlertDialogTitle>
          <AlertDialogDescription>
            Hành động này không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            onClick={run}
            data-testid="bulk-delete-partners-confirm"
          >
            Xoá
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
