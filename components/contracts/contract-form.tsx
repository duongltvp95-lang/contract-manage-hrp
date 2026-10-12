"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  CreateContractSchema,
  getContractWarnings,
  type CreateContractInput,
} from "@schemas/contract";

import {
  createContractAction,
  extractContractAction,
  updateContractAction,
} from "@/app/(app)/contracts/actions";
import { putFileWithProgress, type PendingFile } from "@/lib/upload";
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

  const handleResetCompany = useCallback(() => {
    form.setValue("companyId", "", { shouldDirty: false, shouldValidate: false });
  }, [form]);

  const [extraCompany, setExtraCompany] = useState<{ id: string; name: string } | null>(
    contract?.company_id && contract?.company_name
      ? { id: contract.company_id, name: contract.company_name }
      : null,
  );

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
    onResetCompany: handleResetCompany,
    extraCompany,
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
  const [isExtractingAi, setIsExtractingAi] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);

  async function handleExtractAi(fileItem: PendingFile) {
    setIsExtractingAi(true);
    setAiSummary(null);

    try {
      const formData = new FormData();

      // Nếu tệp lớn hơn 3.5 MB (như tệp 5 MB), tải trực tiếp lên Cloudflare R2
      // để vượt qua giới hạn payload 4.5 MB của Vercel Serverless
      if (fileItem.file.size > 3.5 * 1024 * 1024) {
        const presignRes = await fetch("/api/ai/upload-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filename: fileItem.file.name,
            mimeType: fileItem.file.type,
            fileSize: fileItem.file.size,
          }),
        });

        if (!presignRes.ok) {
          const errPayload = await presignRes.json().catch(() => null);
          throw new Error(errPayload?.error ?? "Không thể chuẩn bị tải tệp lên máy chủ");
        }

        const {
          uploadUrl,
          objectKey,
          mimeType: serverMime,
        } = (await presignRes.json()) as {
          uploadUrl: string;
          objectKey: string;
          mimeType?: string;
        };

        const targetMime = serverMime || fileItem.file.type || "application/pdf";

        await putFileWithProgress(uploadUrl, fileItem.file, {
          contentType: targetMime,
        });

        formData.append("objectKey", objectKey);
        formData.append("filename", fileItem.file.name);
        formData.append("mimeType", targetMime);
      } else {
        formData.append("file", fileItem.file);
      }

      const result = await extractContractAction(formData);

      if (!result.ok) {
        toast.error("Không thể trích xuất thông tin bằng AI", {
          description: result.message,
          duration: 6000,
        });
        return;
      }

      const data = result.data;
      const filledFields: string[] = [];

      if (data.contractNumber) {
        form.setValue("contractNumber", data.contractNumber, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push("Số HĐ");
      }

      if (data.signedDate) {
        form.setValue("signedDate", data.signedDate, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push("Ngày ký");
      }

      if (data.expiryDate) {
        form.setValue("expiryDate", data.expiryDate, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push("Ngày hết hạn");
      }

      if (data.durationText) {
        form.setValue("durationText", data.durationText, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push("Thời hạn");
      }

      if (data.matchedPartnerId && data.matchedPartnerName) {
        setPartnerOptions((current) =>
          current.some((option) => option.id === data.matchedPartnerId)
            ? current
            : [...current, { id: data.matchedPartnerId!, name: data.matchedPartnerName! }].sort((a, b) =>
                a.name.localeCompare(b.name, "vi"),
              ),
        );

        form.setValue("partnerId", data.matchedPartnerId, {
          shouldValidate: true,
          shouldDirty: true,
        });

        if (data.isNewPartner) {
          filledFields.push(`Tự động thêm đối tác "${data.matchedPartnerName}"`);
        } else {
          filledFields.push(`Đối tác: ${data.matchedPartnerName}`);
        }
      }

      if (data.matchedCompanyId && data.matchedCompanyName) {
        setExtraCompany({
          id: data.matchedCompanyId,
          name: data.matchedCompanyName,
        });

        form.setValue("companyId", data.matchedCompanyId, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push(`Công ty: ${data.matchedCompanyName}`);
      }

      if (data.summary) {
        setAiSummary(data.summary);
      }

      const toastTitle = data.isNewPartner
        ? "✨ AI đã trích xuất & tự động thêm đối tác mới!"
        : "✨ AI đã trích xuất thành công thông tin hợp đồng!";

      toast.success(toastTitle, {
        description:
          filledFields.length > 0
            ? `Đã điền: ${filledFields.join(", ")}.`
            : "Đã phân tích xong nội dung tệp đính kèm.",
      });
    } catch (err) {
      toast.error("Trích xuất AI gặp sự cố", {
        description: err instanceof Error ? err.message : "Vui lòng thử lại sau.",
      });
    } finally {
      setIsExtractingAi(false);
    }
  }

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
    router.prefetch(`/contracts/${created.data.id}`);
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

        {aiSummary && (
          <Alert className="border-purple-200 bg-purple-50/70 dark:border-purple-900/50 dark:bg-purple-950/20">
            <Sparkles className="h-4 w-4 text-purple-600 dark:text-purple-400" />
            <AlertTitle className="text-purple-950 dark:text-purple-200 font-semibold">
              Tóm tắt nội dung hợp đồng từ AI
            </AlertTitle>
            <AlertDescription className="text-purple-900/90 dark:text-purple-300">
              {aiSummary}
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
            onExtractAi={handleExtractAi}
            isExtractingAi={isExtractingAi}
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
          <Button type="submit" disabled={busy || isExtractingAi} data-testid="contract-form-submit">
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {phase === "saving"
              ? isEdit
                ? "Đang lưu thay đổi..."
                : "Đang lưu hợp đồng..."
              : phase === "uploading"
                ? "Đang tải tệp lên..."
                : phase === "redirecting"
                  ? "Đang mở hợp đồng..."
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
