"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  CreateContractSchema,
  getContractWarnings,
  type CreateContractInput,
} from "@schemas/contract";

import {
  createContractAction,
  updateContractAction,
} from "@/app/(app)/contracts/actions";
import { DateField } from "@/components/contracts/date-field";
import { ContractCompanyField } from "@/components/contracts/contract-company-field";
import { ContractFileAttachments } from "@/components/contracts/contract-file-attachments";
import { usePartnerCompanies } from "@/components/contracts/hooks/use-partner-companies";
import { useContractUploads } from "@/components/contracts/hooks/use-contract-uploads";
import {
  PartnerCombobox,
  type PartnerOption,
} from "@/components/partners/partner-combobox";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { isLegacyPartnerText } from "@/lib/partner-display";
import type { ContractRow } from "@/lib/services/contracts";
import type { PartnerRow } from "@/lib/services/partners";

const EMPTY_VALUES: CreateContractInput = {
  contractNumber: "",
  signedDate: "",
  durationText: "",
  expiryDate: "",
  partnerText: "",
  partnerId: "",
  companyId: "",
  notes: "",
};

/** The subset of a contract the form can edit. */
export type EditableContract = Pick<
  ContractRow,
  | "id"
  | "contract_number"
  | "signed_date"
  | "duration_text"
  | "expiry_date"
  | "partner_text"
  | "partner_id"
  | "company_id"
  | "notes"
> & {
  /** Resolved by `getContract`; used only to tell a legacy row from a linked one. */
  partner_name?: string | null;
  /** Resolved by `getContract`; tên công ty (round 33+) */
  company_name?: string | null;
};

function toFormValues(contract: EditableContract | null | undefined): CreateContractInput {
  if (!contract) return EMPTY_VALUES;

  return {
    contractNumber: contract.contract_number ?? "",
    signedDate: contract.signed_date ?? "",
    durationText: contract.duration_text ?? "",
    expiryDate: contract.expiry_date ?? "",
    partnerText: contract.partner_text ?? "",
    partnerId: contract.partner_id ?? "",
    companyId: contract.company_id ?? "",
    notes: contract.notes ?? "",
  };
}

/**
 * Contract form — refactored in Round 33 (Task #2).
 *
 * ONE implementation for both create and edit.
 */
export function ContractForm({
  mode = "create",
  maxUploadSizeMb = 0,
  contract = null,
  partners = [],
  onUpdated,
  onCancel,
}: {
  mode?: "create" | "edit";
  /** Create only — the dropzone needs the limit. */
  maxUploadSizeMb?: number;
  /** Edit only — the contract being changed. */
  contract?: EditableContract | null;
  /** The organization's partner directory, read on the server. */
  partners?: PartnerOption[];
  /** Edit only — called after a successful save, before the refresh. */
  onUpdated?: (row: ContractRow) => void;
  /** Edit only — dismisses the containing Sheet. */
  onCancel?: () => void;
}) {
  const router = useRouter();
  const isEdit = mode === "edit";

  const form = useForm<CreateContractInput>({
    resolver: zodResolver(CreateContractSchema),
    defaultValues: toFormValues(contract),
  });

  const [partnerOptions, setPartnerOptions] = useState<PartnerOption[]>(partners);

  function addPartnerOption(partner: PartnerRow) {
    setPartnerOptions((current) =>
      current.some((option) => option.id === partner.id)
        ? current
        : [...current, { id: partner.id, name: partner.name }].sort((a, b) =>
            a.name.localeCompare(b.name, "vi"),
          ),
    );
  }

  const legacyPartnerText =
    isEdit &&
    isLegacyPartnerText({
      partner_name: contract?.partner_name ?? null,
      partner_text: contract?.partner_text ?? null,
    })
      ? (contract?.partner_text ?? null)
      : null;

  const selectedPartner =
    contract?.partner_id && contract?.partner_name
      ? { id: contract.partner_id, name: contract.partner_name }
      : null;

  const partnerId = useWatch({ control: form.control, name: "partnerId" });

  // Hook quản lý tải danh sách công ty theo đối tác
  const {
    companyRows,
    companiesError,
    companiesLoading,
    retryCompanies,
  } = usePartnerCompanies({
    partnerId,
    isEdit,
    defaultCompanyId: contract?.company_id,
    defaultCompanyName: contract?.company_name,
    currentCompanyId: form.getValues("companyId"),
    onResetCompany: () => {
      form.setValue("companyId", "", { shouldDirty: false, shouldValidate: false });
    },
  });

  // Hook quản lý tải tệp hợp đồng lên R2
  const {
    files,
    phase,
    setPhase,
    uploadError,
    setUploadError,
    setSavedContractId,
    failedCount,
    hasFiles,
    busy,
    mergeFiles,
    runUploads,
    retryUploads,
  } = useContractUploads({
    onSuccess: (contractId) => {
      toast.success("Đã tạo hợp đồng");
      router.push(`/contracts/${contractId}`);
    },
  });

  const [formError, setFormError] = useState<string | null>(null);

  const signedDate = useWatch({ control: form.control, name: "signedDate" });
  const expiryDate = useWatch({ control: form.control, name: "expiryDate" });
  const warnings = getContractWarnings({ signedDate, expiryDate });

  async function submitEdit(values: CreateContractInput) {
    if (!contract) return;

    setFormError(null);
    setPhase("saving");

    const result = await updateContractAction(contract.id, values);

    if (!result.ok) {
      setFormError(result.message);
      setPhase("failed");
      return;
    }

    setPhase("done");
    toast.success("Đã cập nhật hợp đồng");
    onUpdated?.(result.data);
  }

  async function onSubmit(values: CreateContractInput) {
    if (isEdit) {
      await submitEdit(values);
      return;
    }

    setFormError(null);
    setUploadError(null);
    setPhase("saving");

    const created = await createContractAction(values);

    if (!created.ok) {
      setFormError(created.message);
      setPhase("failed");
      return;
    }

    setSavedContractId(created.data.id);
    await runUploads(created.data.id, files);
  }

  const fields = (
    <div className={isEdit ? "grid gap-6" : "grid gap-6 md:grid-cols-2"}>
      <FormField
        control={form.control}
        name="contractNumber"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Số hợp đồng</FormLabel>
            <FormControl>
              <Input placeholder="VD: 12/2026/HĐKT" disabled={busy} {...field} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="partnerId"
        rules={{
          validate: (value) => {
            if (isEdit) return true;
            return value && value.length > 0 ? true : "Vui lòng chọn đối tác";
          },
        }}
        render={({ field }) => (
          <FormItem>
            <FormLabel>Đối tác</FormLabel>
            <FormControl>
              <PartnerCombobox
                id="partnerId"
                value={field.value ?? ""}
                onChange={field.onChange}
                partners={partnerOptions}
                selectedPartner={selectedPartner}
                onPartnerCreated={addPartnerOption}
                disabled={busy}
                invalid={Boolean(form.formState.errors.partnerId)}
              />
            </FormControl>
            {legacyPartnerText ? (
              <FormDescription data-testid="legacy-partner-text">
                Hợp đồng cũ ghi đối tác dạng văn bản: “{legacyPartnerText}”. Chọn
                một đối tác ở trên nếu muốn liên kết với danh bạ; để trống thì hợp
                đồng giữ nguyên nội dung cũ.
              </FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />

      {/* Cột Công ty: bóc tách sang sub-component ContractCompanyField */}
      <ContractCompanyField
        control={form.control}
        partnerId={partnerId}
        companyRows={companyRows}
        companiesError={companiesError}
        companiesLoading={companiesLoading}
        onRetry={retryCompanies}
        busy={busy}
        isEdit={isEdit}
        hasError={Boolean(form.formState.errors.companyId)}
      />

      <FormField
        control={form.control}
        name="signedDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Ngày ký</FormLabel>
            <DateField
              id="signedDate"
              value={field.value}
              onChange={field.onChange}
              disabled={busy}
            />
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="expiryDate"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Ngày hết hạn</FormLabel>
            <DateField
              id="expiryDate"
              value={field.value}
              onChange={field.onChange}
              disabled={busy}
            />
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="durationText"
        render={({ field }) => (
          <FormItem className={isEdit ? undefined : "md:col-span-2"}>
            <FormLabel>Thời hạn</FormLabel>
            <FormControl>
              <Input
                placeholder='VD: 12 tháng, hoặc "Không xác định thời hạn"'
                disabled={busy}
                {...field}
              />
            </FormControl>
            <FormDescription>
              Có thể để trống nếu đã có ngày hết hạn.
            </FormDescription>
            <FormMessage />
          </FormItem>
        )}
      />
    </div>
  );

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
        {isEdit ? (
          fields
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Thông tin hợp đồng</CardTitle>
              <CardDescription>
                Nhập thủ công các thông tin chính của hợp đồng.
              </CardDescription>
            </CardHeader>
            <CardContent>{fields}</CardContent>
          </Card>
        )}

        {warnings.length > 0 && (
          <Alert variant="destructive">
            <AlertTitle>Cảnh báo</AlertTitle>
            <AlertDescription>
              <ul className="list-disc pl-4">
                {warnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}

        {/* Tệp hợp đồng & phụ lục: bóc tách sang sub-component ContractFileAttachments */}
        {!isEdit && (
          <ContractFileAttachments
            files={files}
            onMergeFiles={mergeFiles}
            maxUploadSizeMb={maxUploadSizeMb}
            busy={busy}
            uploadError={uploadError}
            failedCount={failedCount}
            onRetryUploads={retryUploads}
          />
        )}

        {formError && (
          <Alert variant="destructive">
            <AlertTitle>
              {isEdit ? "Không cập nhật được hợp đồng" : "Không lưu được hợp đồng"}
            </AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <div className="flex items-center gap-3">
          <Button type="submit" disabled={busy} data-testid="contract-form-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {phase === "saving"
              ? isEdit
                ? "Đang lưu thay đổi..."
                : "Đang lưu hợp đồng..."
              : phase === "uploading"
                ? "Đang tải tệp lên..."
                : isEdit
                  ? "Lưu thay đổi"
                  : "Lưu hợp đồng"}
          </Button>

          {isEdit && onCancel ? (
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
              data-testid="contract-form-cancel"
            >
              Huỷ
            </Button>
          ) : null}

          {!isEdit && hasFiles && !busy && (
            <span className="text-sm text-muted-foreground">
              {files.length} tệp sẽ được tải lên
            </span>
          )}
        </div>
      </form>
    </Form>
  );
}
