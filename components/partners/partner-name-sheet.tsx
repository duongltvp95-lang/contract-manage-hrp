"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { PartnerSchema, type CreatePartnerInput } from "@schemas/partner";

import {
  createPartnerAction,
  updatePartnerAction,
} from "@/app/(app)/partners/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import type { PartnerRow } from "@/lib/services/partners";

/**
 * Add / edit a partner — feature round 2, part 2 + part 3.
 *
 * Reuses the edit-contract pattern exactly: a shadcn Sheet holding a
 * react-hook-form form validated by the shared Zod schema, a server action, then
 * a toast and `router.refresh()` so the server re-reads the list. There is no
 * client-side cache to keep in sync.
 *
 * There is deliberately NO delete control on this component — not disabled, not
 * hidden, absent. The database agrees: `authenticated` has no DELETE grant and
 * there is no DELETE policy on `partners`.
 *
 * The same component serves both modes and can be driven either by a trigger
 * (`<PartnerNameSheet mode="create" trigger={...} />`) or programmatically
 * (`open` / `onOpenChange`), which is how the contract form's combobox opens it.
 *
 * The component name stays `PartnerNameSheet` on purpose — REUSE-FIRST rule:
 * every existing import (combobox, rename button, add button) keeps working
 * without a sweeping rename. The form now exposes three fields (name, address,
 * tax code) but the API surface (`mode`, `partner`, `onSaved`, `trigger`,
 * `open`, `onOpenChange`) is unchanged. The two optional fields are part 3.
 */

export type PartnerNameSheetProps = {
  mode: "create" | "edit";
  /** Edit only — the partner being renamed. */
  partner?: Pick<PartnerRow, "id" | "name" | "address" | "tax_code"> | null;
  /** Called with the saved row, before the refresh. */
  onSaved?: (row: PartnerRow) => void;
  /** Optional trigger; omit when the sheet is opened programmatically. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function PartnerNameSheet({
  mode,
  partner = null,
  onSaved,
  trigger,
  open,
  onOpenChange,
}: PartnerNameSheetProps) {
  const router = useRouter();
  const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isControlled = open !== undefined;
  const sheetOpen = isControlled ? open : uncontrolledOpen;

  const setSheetOpen = (next: boolean) => {
    if (!isControlled) setUncontrolledOpen(next);
    onOpenChange?.(next);
    if (!next) setFormError(null);
  };

  const form = useForm<CreatePartnerInput>({
    resolver: zodResolver(PartnerSchema),
    defaultValues: {
      name: partner?.name ?? "",
      // `?? ""` keeps the form happy when the field is null on the row.
      address: partner?.address ?? "",
      taxCode: partner?.tax_code ?? "",
    },
  });

  async function onSubmit(values: CreatePartnerInput) {
    setFormError(null);
    setSaving(true);

    const result =
      mode === "edit" && partner
        ? await updatePartnerAction(partner.id, values)
        : await createPartnerAction(values);

    setSaving(false);

    if (!result.ok) {
      // Plan section 80: a readable Vietnamese message, never a raw stack trace.
      setFormError(result.message);
      return;
    }

    toast.success(mode === "edit" ? "Đã cập nhật đối tác" : "Đã thêm đối tác");
    onSaved?.(result.data);
    setSheetOpen(false);
    form.reset({
      name: result.data.name,
      address: result.data.address ?? "",
      taxCode: result.data.tax_code ?? "",
    });
    router.refresh();
  }

  return (
    <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
      {trigger ? <SheetTrigger asChild>{trigger}</SheetTrigger> : null}

      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-md"
        data-testid="partner-name-sheet"
      >
        <SheetHeader>
          <SheetTitle>
            {mode === "edit" ? "Sửa thông tin đối tác" : "Thêm đối tác"}
          </SheetTitle>
          <SheetDescription>
            {mode === "edit"
              ? "Đổi tên, địa chỉ hoặc mã số thuế. Hợp đồng đã gắn vẫn giữ nguyên."
              : "Nhập tên đối tác để dùng lại khi tạo hợp đồng. Địa chỉ và mã số thuế có thể bổ sung sau."}
          </SheetDescription>
        </SheetHeader>

        <div className="px-4 pb-8">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="name"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Tên đối tác</FormLabel>
                    <FormControl>
                      <Input
                        id="partnerName"
                        placeholder="VD: Công ty TNHH Samsung Electronics Việt Nam"
                        autoComplete="off"
                        disabled={saving}
                        data-testid="partner-name-input"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="address"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Địa chỉ</FormLabel>
                    <FormControl>
                      <Textarea
                        id="partnerAddress"
                        placeholder="VD: Số 9, đường Bắc Hà, phường Thanh Xuân Bắc, Hà Nội"
                        autoComplete="off"
                        disabled={saving}
                        rows={3}
                        data-testid="partner-address-input"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Không bắt buộc. Tối đa 500 ký tự.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="taxCode"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Mã số thuế</FormLabel>
                    <FormControl>
                      <Input
                        id="partnerTaxCode"
                        placeholder="VD: 0123456789 hoặc 0123456789-001"
                        autoComplete="off"
                        disabled={saving}
                        inputMode="numeric"
                        data-testid="partner-tax-code-input"
                        {...field}
                        value={field.value ?? ""}
                      />
                    </FormControl>
                    <FormDescription>
                      Không bắt buộc. 10 chữ số, thêm -NNN nếu là mã chi nhánh.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {formError && (
                <Alert variant="destructive">
                  <AlertTitle>
                    {mode === "edit"
                      ? "Không cập nhật được đối tác"
                      : "Không thêm được đối tác"}
                  </AlertTitle>
                  <AlertDescription>{formError}</AlertDescription>
                </Alert>
              )}

              <div className="flex items-center gap-3">
                <Button
                  type="submit"
                  disabled={saving}
                  data-testid="partner-name-submit"
                >
                  {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  {mode === "edit" ? "Lưu thay đổi" : "Thêm đối tác"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setSheetOpen(false)}
                >
                  Huỷ
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** The "+ Thêm đối tác" trigger used on the partners page. */
export function AddPartnerButton() {
  return (
    <PartnerNameSheet
      mode="create"
      trigger={
        <Button data-testid="partner-add-button">
          <Plus className="mr-2 h-4 w-4" />
          Thêm đối tác
        </Button>
      }
    />
  );
}

/** The "Sửa" trigger used in a table row and on the detail header. */
export function RenamePartnerButton({
  partner,
}: {
  partner: Pick<PartnerRow, "id" | "name" | "address" | "tax_code">;
}) {
  return (
    <PartnerNameSheet
      mode="edit"
      partner={partner}
      trigger={
        <Button variant="outline" size="sm" data-testid="partner-rename-button">
          <Pencil className="mr-1 h-4 w-4" />
          Sửa
        </Button>
      }
    />
  );
}