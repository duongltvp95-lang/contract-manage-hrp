"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil, Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import {
  PARTNER_STATUS_LABELS,
  PARTNER_STATUSES,
  PartnerSchema,
  type CreatePartnerInput,
} from "@schemas/partner";

import {
  createPartnerAction,
  listCompaniesAction,
  updatePartnerAction,
} from "@/app/(app)/partners/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import type { Company, PartnerDetail, PartnerRow } from "@/lib/services/partners";

/**
 * Add / edit a partner — feature round 2, part 2 + part 3 + round 10, part 2.
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
 * Round 10 adds the collaboration status (Select) and the company checkboxes
 * (HRP / HR VN, fetched from the organization). The companies list is tiny and
 * stable, so it is fetched once when the sheet mounts rather than threaded
 * through every caller.
 */

export type PartnerNameSheetProps = {
  mode: "create" | "edit";
  /** Edit only — the partner being edited (status + current company names). */
  partner?: (Pick<PartnerRow, "id" | "name" | "address" | "tax_code" | "status"> & {
    companies: string[];
  }) | null;
  /** Called with the saved row, before the refresh. */
  onSaved?: (row: PartnerDetail) => void;
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
  const [companies, setCompanies] = useState<Company[]>([]);

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
      status: partner?.status ?? "active",
      companyIds: [],
    },
  });

  // Load the org's companies once; pre-check the edit-mode selection by mapping
  // the current company names back to ids.
  useEffect(() => {
    let active = true;
    listCompaniesAction().then((result) => {
      if (!active || !result.ok) return;
      setCompanies(result.data);
      if (partner) {
        form.setValue(
          "companyIds",
          result.data
            .filter((company) => partner.companies.includes(company.name))
            .map((company) => company.id),
        );
      }
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
      status: result.data.status ?? "active",
      companyIds: result.data.companies
        .map((name) => companies.find((company) => company.name === name)?.id)
        .filter((id): id is string => Boolean(id)),
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
              ? "Đổi tên, địa chỉ, mã số thuế, trạng thái hợp tác hoặc công ty."
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

              {/* Round 10 — collaboration status */}
              <FormField
                control={form.control}
                name="status"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Trạng thái hợp tác</FormLabel>
                    <Select
                      value={field.value}
                      onValueChange={field.onChange}
                      disabled={saving}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="partner-status-select">
                          <SelectValue placeholder="Chọn trạng thái" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        {PARTNER_STATUSES.map((status) => (
                          <SelectItem key={status} value={status}>
                            {PARTNER_STATUS_LABELS[status]}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Round 10 — companies */}
              <FormField
                control={form.control}
                name="companyIds"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Công ty</FormLabel>
                    <div className="space-y-2">
                      {companies.length === 0 ? (
                        <p className="text-sm text-muted-foreground">
                          Đang tải danh sách công ty…
                        </p>
                      ) : (
                        companies.map((company) => {
                          const checked = field.value.includes(company.id);
                          return (
                            <div
                              key={company.id}
                              className="flex items-center gap-2"
                            >
                              <Checkbox
                                id={`company-${company.id}`}
                                checked={checked}
                                disabled={saving}
                                onCheckedChange={(next) => {
                                  const nextIds = next
                                    ? [...field.value, company.id]
                                    : field.value.filter((id) => id !== company.id);
                                  field.onChange(nextIds);
                                }}
                                data-testid={`company-checkbox-${company.name}`}
                              />
                              <Label htmlFor={`company-${company.id}`}>{company.name}</Label>
                            </div>
                          );
                        })
                      )}
                    </div>
                    <FormDescription>
                      Chọn ít nhất một công ty. Có thể chọn cả hai.
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
                  disabled={saving || companies.length === 0}
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
  partner: Pick<PartnerRow, "id" | "name" | "address" | "tax_code" | "status"> & {
    companies: string[];
  };
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
