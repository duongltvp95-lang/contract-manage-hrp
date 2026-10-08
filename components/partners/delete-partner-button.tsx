"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { deletePartnerAction } from "@/app/(app)/partners/actions";
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
 * Round 19 — hard-delete a partner (only rendered for the delete-admin emails).
 *
 * A partner that still has contracts is refused by the service with a clear
 * message, surfaced here as an error toast.
 */
export function DeletePartnerButton({
  partnerId,
  label,
  onDeleted,
  redirectTo,
}: {
  partnerId: string;
  label?: string;
  onDeleted?: () => void;
  /** Navigate here after a successful delete (e.g. the detail page → list). */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    const result = await deletePartnerAction(partnerId);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success("Đã xoá đối tác");
    if (redirectTo) router.push(redirectTo);
    else if (onDeleted) onDeleted();
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
            data-testid={`partner-delete-${partnerId}`}
          >
            <Trash2 className="mr-1 h-4 w-4" />
            {label}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            disabled={busy}
            data-testid={`partner-delete-${partnerId}`}
            aria-label="Xoá đối tác"
          >
            <Trash2 className="h-4 w-4 text-destructive" />
          </Button>
        )}
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Xoá đối tác này?</AlertDialogTitle>
          <AlertDialogDescription>
            Hành động này không thể hoàn tác.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction onClick={run} data-testid="partner-delete-confirm">
            Xoá
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
