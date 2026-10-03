"use client";

import { Pencil } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import {
  ContractForm,
  type EditableContract,
} from "@/components/contracts/contract-form";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

/**
 * Edit Contract — plan section 65, W1-WEB-031.
 *
 * A shadcn Sheet holding the shared `ContractForm` in edit mode; there is no
 * second form implementation. On success the Sheet closes and `router.refresh()`
 * re-reads the contract on the server, so the detail header and the list both
 * show the new values without any client-side cache to keep in sync.
 */
export function EditContractSheet({ contract }: { contract: EditableContract }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" data-testid="contract-edit-button">
          <Pencil className="mr-1 h-4 w-4" />
          Sửa
        </Button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
        data-testid="edit-contract-sheet"
      >
        <SheetHeader>
          <SheetTitle>Sửa hợp đồng</SheetTitle>
          <SheetDescription>
            Cập nhật thông tin của hợp đồng
            {contract.contract_number ? ` ${contract.contract_number}` : ""}. Tệp
            đính kèm không thay đổi.
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-8">
          {/* Keyed by id: if the server sends fresh values the form re-initialises. */}
          <ContractForm
            key={contract.id}
            mode="edit"
            contract={contract}
            onCancel={() => setOpen(false)}
            onUpdated={() => {
              setOpen(false);
              router.refresh();
            }}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
}
