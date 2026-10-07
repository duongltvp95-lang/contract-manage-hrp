"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { setPartnerStatusAction } from "@/app/(app)/partners/actions";
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
import type { PartnerStatus } from "@schemas/partner";

/**
 * Round 10 — the quick toggle on the partner detail page.
 *
 * "Dừng hợp tác" asks for a light confirmation (it hides the partner from the
 * new-contract combobox); "Khôi phục hợp tác" is a single click. The state comes
 * from the server after the action; the page is re-read with `router.refresh()`.
 */
export function PartnerStatusToggle({
  partnerId,
  status,
}: {
  partnerId: string;
  status: PartnerStatus;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function run(next: PartnerStatus) {
    setBusy(true);
    const result = await setPartnerStatusAction(partnerId, next);
    setBusy(false);

    if (!result.ok) {
      toast.error(result.message);
      return;
    }

    toast.success(
      next === "stopped"
        ? "Đã dừng hợp tác với đối tác"
        : "Đã khôi phục hợp tác với đối tác",
    );
    router.refresh();
  }

  if (status === "stopped") {
    return (
      <Button
        variant="outline"
        disabled={busy}
        onClick={() => run("active")}
        data-testid="partner-restore-button"
      >
        Khôi phục hợp tác
      </Button>
    );
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          disabled={busy}
          data-testid="partner-stop-button"
        >
          Dừng hợp tác
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Dừng hợp tác với đối tác này?</AlertDialogTitle>
          <AlertDialogDescription>
            Đối tác vẫn còn trong danh bạ và các hợp đồng cũ vẫn giữ nguyên, nhưng
            sẽ không xuất hiện khi tạo hợp đồng mới.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => run("stopped")}
            data-testid="partner-stop-confirm"
          >
            Dừng hợp tác
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
