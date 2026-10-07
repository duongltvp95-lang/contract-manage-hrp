"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  CreateContractSchema,
  getContractWarnings,
  type CreateContractInput,
} from "@schemas/contract";
import type { FileKind } from "@schemas/file";

import {
  completeUploadAction,
  createContractAction,
  updateContractAction,
} from "@/app/(app)/contracts/actions";
import { DateField } from "@/components/contracts/date-field";
import {
  PartnerCombobox,
  type PartnerOption,
} from "@/components/partners/partner-combobox";
import { UploadDropzone } from "@/components/documents/upload-dropzone";
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
import { putFileWithProgress, type PendingFile } from "@/lib/upload";

/**
 * Contract form — plan sections 42, 45, 46, 47, 65.
 *
 * ONE implementation for both create and edit (plan section 65: "Do not create
 * separate form implementation"). The only differences are the initial values,
 * which action is called, and whether the file dropzone is present — editing a
 * contract never uploads files in Wave 1.
 *
 * Create — orchestration (plan section 42):
 *   1. create the contract row (server action, organization from the session)
 *   2. per file: presign -> browser PUT to R2 (real XHR progress)
 *   3. persist `contract_files` (server action, HEAD-verified)
 *   4. redirect to the contract detail
 * If step 2/3 fails the contract stays saved and the form keeps its values, so
 * the user can retry just the uploads (plan section 44).
 *
 * Edit — `updateContractAction` (organization and contract id from the session),
 * then the parent refreshes and the Sheet closes.
 *
 * `UpdateContractSchema` is the same schema as `CreateContractSchema`
 * (`UpdateContractSchema = CreateContractSchema` in packages/schemas), so one
 * resolver covers both modes.
 */

type Phase = "idle" | "saving" | "uploading" | "done" | "failed";

const EMPTY_VALUES: CreateContractInput = {
  contractNumber: "",
  signedDate: "",
  durationText: "",
  expiryDate: "",
  partnerText: "",
  partnerId: "",
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
  | "notes"
> & {
  /** Resolved by `getContract`; used only to tell a legacy row from a linked one. */
  partner_name?: string | null;
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
    notes: contract.notes ?? "",
  };
}

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

  /**
   * The directory as this form knows it: the server's list plus anything created
   * from inside the combobox. A partner added inline is selected immediately, so
   * it has to exist here before the next render.
   */
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

  /**
   * A contract that predates the directory: free text, no link.
   *
   * Its text is shown read-only and the partner stays optional, so re-saving an
   * old contract cannot rewrite what it says.
   */
  const legacyPartnerText =
    isEdit &&
    isLegacyPartnerText({
      partner_name: contract?.partner_name ?? null,
      partner_text: contract?.partner_text ?? null,
    })
      ? (contract?.partner_text ?? null)
      : null;

  /**
   * The partner the contract is already linked to. Passed to the combobox so
   * the selected name still shows (and stays selectable) when it sorts past
   * the first page of a large directory (round 6).
   */
  const selectedPartner =
    contract?.partner_id && contract?.partner_name
      ? { id: contract.partner_id, name: contract.partner_name }
      : null;

  const [files, setFiles] = useState<PendingFile[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [formError, setFormError] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [savedContractId, setSavedContractId] = useState<string | null>(null);

  // `useWatch` rather than `form.watch()`: the latter returns an unmemoizable
  // function that React Compiler refuses to optimise around.
  const signedDate = useWatch({ control: form.control, name: "signedDate" });
  const expiryDate = useWatch({ control: form.control, name: "expiryDate" });
  const warnings = getContractWarnings({ signedDate, expiryDate });

  const busy = phase === "saving" || phase === "uploading";

  function patchFile(id: string, patch: Partial<PendingFile>) {
    setFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  /** Replaces the files of one kind with the list a dropzone just produced. */
  function mergeFiles(kind: FileKind, next: PendingFile[]) {
    setFiles((current) => [
      ...current.filter((item) => item.kind !== kind),
      ...next,
    ]);
  }

  async function uploadOne(contractId: string, pending: PendingFile) {
    patchFile(pending.id, { status: "uploading", progress: 0, error: undefined });

    // 1. ask the server for a presigned PUT (authorization happens there)
    const presignResponse = await fetch("/api/files/upload-url", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contractId,
        filename: pending.file.name,
        mimeType: pending.file.type,
        fileSize: pending.file.size,
        kind: pending.kind,
      }),
    });

    if (!presignResponse.ok) {
      const payload = await presignResponse.json().catch(() => null);
      throw new Error(
        payload?.error ?? `Không lấy được URL tải lên (HTTP ${presignResponse.status})`,
      );
    }

    const { fileId, objectKey, uploadUrl } = (await presignResponse.json()) as {
      fileId: string;
      objectKey: string;
      uploadUrl: string;
    };

    // 2. upload the bytes straight to R2 — plan section 40
    await putFileWithProgress(uploadUrl, pending.file, {
      contentType: pending.file.type,
      onProgress: (progress) => patchFile(pending.id, { progress: progress.percent }),
    });

    patchFile(pending.id, { fileId, objectKey, progress: 100 });

    // 3. persist the metadata row
    const persisted = await completeUploadAction({
      contractId,
      fileId,
      objectKey,
      filename: pending.file.name,
      mimeType: pending.file.type,
      fileSize: pending.file.size,
      kind: pending.kind,
    });

    if (!persisted.ok) {
      throw new Error(persisted.message);
    }

    patchFile(pending.id, { status: "done" });
  }

  async function runUploads(contractId: string, queue: PendingFile[]) {
    if (queue.length === 0) {
      finish(contractId);
      return;
    }

    setPhase("uploading");
    setUploadError(null);

    const failures: string[] = [];

    for (const pending of queue) {
      try {
        await uploadOne(contractId, pending);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Tải lên thất bại";
        failures.push(`${pending.file.name}: ${message}`);
        patchFile(pending.id, { status: "error", error: message });
      }
    }

    if (failures.length === 0) {
      finish(contractId);
      return;
    }

    setUploadError(failures.join("\n"));
    setPhase("failed");
  }

  function finish(contractId: string) {
    setPhase("done");
    toast.success("Đã tạo hợp đồng");
    router.push(`/contracts/${contractId}`);
  }

  /** Plan section 65 — same fields, different action. */
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

  /** Plan section 44 — the contract is already saved, so retry only the files. */
  async function retryUploads() {
    if (!savedContractId) return;
    const queue = files.filter(
      (item) => item.status === "pending" || item.status === "error",
    );
    await runUploads(savedContractId, queue);
  }

  const failedCount = files.filter((item) => item.status === "error").length;
  const hasFiles = files.length > 0;

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
            // Only a NEW contract must name a partner (owner decision, round 2).
            // A contract created before the directory existed keeps its free text
            // and is never forced to choose one.
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

        {/* Edit never touches documents — that arrives with the M8 work. */}
        {!isEdit && (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Tài liệu hợp đồng</CardTitle>
                <CardDescription>
                  PDF, JPG hoặc PNG. Có thể tải lên nhiều tệp cho một hợp đồng.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UploadDropzone
                  files={files.filter((f) => f.kind === "document")}
                  onFilesChange={(next) => mergeFiles("document", next)}
                  maxUploadSizeMb={maxUploadSizeMb}
                  kind="document"
                  disabled={busy}
                  inputTestId="document-dropzone-input"
                />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Phụ lục hợp đồng</CardTitle>
                <CardDescription>
                  Chỉ chấp nhận file PDF. Có thể tải lên nhiều phụ lục.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <UploadDropzone
                  files={files.filter((f) => f.kind === "appendix")}
                  onFilesChange={(next) => mergeFiles("appendix", next)}
                  maxUploadSizeMb={maxUploadSizeMb}
                  accept={{ "application/pdf": [".pdf"] }}
                  kind="appendix"
                  hint={`Chỉ chấp nhận file PDF — tối đa ${maxUploadSizeMb} MB mỗi tệp. Có thể chọn nhiều tệp.`}
                  disabled={busy}
                  inputTestId="appendix-dropzone-input"
                />
              </CardContent>
            </Card>
          </>
        )}

        {formError && (
          <Alert variant="destructive">
            <AlertTitle>
              {isEdit ? "Không cập nhật được hợp đồng" : "Không lưu được hợp đồng"}
            </AlertTitle>
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        {!isEdit && uploadError && (
          <Alert variant="destructive">
            <AlertTitle>
              Hợp đồng đã được lưu, nhưng tải tệp lên thất bại
            </AlertTitle>
            <AlertDescription>
              <p className="mb-2 whitespace-pre-line">{uploadError}</p>
              <p className="mb-3">
                Hợp đồng vẫn được giữ lại và thông tin bạn đã nhập không bị mất.
                Bấm &quot;Thử lại&quot; để tải lại {failedCount} tệp lỗi.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={retryUploads}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Thử lại
              </Button>
            </AlertDescription>
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
