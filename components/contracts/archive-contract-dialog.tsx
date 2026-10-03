"use client";

import { Archive, Loader2, MoreHorizontal } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { archiveContractAction } from "@/app/(app)/contracts/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Archive — plan section 66, W1-WEB-032.
 *
 * A shadcn AlertDialog behind the header's `More` menu. Archiving is a soft
 * delete: the server stamps `archived_at` and the row stays in the database.
 * There is deliberately **no hard delete and no unarchive UI** in Wave 1 (owner
 * decision for M7), so the confirmation text says exactly what will happen.
 *
 * The dialog only closes on success — on failure the reason stays on screen
 * instead of vanishing with a toast.
 */
export function ContractActionsMenu({
  contractId,
  contractNumber,
}: {
  contractId: string;
  contractNumber: string | null;
}) {
  const router = useRouter();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirmArchive() {
    setPending(true);
    setError(null);

    const result = await archiveContractAction(contractId);

    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }

    setPending(false);
    setConfirmOpen(false);
    toast.success("Đã lưu trữ hợp đồng");
    router.push("/contracts");
    router.refresh();
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            aria-label="Thao tác khác"
            data-testid="contract-more-button"
          >
            <MoreHorizontal className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="end">
          <DropdownMenuItem
            data-testid="contract-archive-menu-item"
            onSelect={() => {
              setError(null);
              setConfirmOpen(true);
            }}
          >
            <Archive className="mr-2 h-4 w-4" />
            Lưu trữ hợp đồng
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent data-testid="archive-confirm-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>Lưu trữ hợp đồng này?</AlertDialogTitle>
            <AlertDialogDescription>
              Hợp đồng
              {contractNumber ? ` ${contractNumber}` : ""} sẽ bị ẩn khỏi danh sách
              và trang tổng quan. Dữ liệu và tệp đính kèm vẫn được giữ nguyên
              trong hệ thống — Wave 1 không có chức năng xoá vĩnh viễn và cũng
              chưa có chức năng bỏ lưu trữ.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {error && (
            <Alert variant="destructive">
              <AlertTitle>Không lưu trữ được hợp đồng</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Huỷ</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={pending}
              onClick={confirmArchive}
              data-testid="archive-confirm-button"
            >
              {pending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Lưu trữ
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
