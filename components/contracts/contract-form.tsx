"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, RotateCcw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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
import { partnerCompanyRowsAction } from "@/app/(app)/partners/actions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isLegacyPartnerText } from "@/lib/partner-display";
import type { ContractRow } from "@/lib/services/contracts";
import type { Company, PartnerRow } from "@/lib/services/partners";
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
 *
 * Round 33 adds the "Công ty" `<Select>` directly BELOW the partner combobox:
 * the round 32 badge inside the combobox had to wait for a server round trip and
 * read as a lagging control, so the company is now a field the user picks.
 *
 * Round 33+ — danh sách công ty phụ thuộc vào đối tác đang chọn:
 *   - Đổi đối tác → tải lại công ty của đối tác mới qua
 *     `partnerCompanyRowsAction(partnerId)` (trả về `{id, name}[]`).
 *   - Chưa chọn đối tác / đối tác chưa gán công ty → Select bị disable và hiện
 *     gợi ý tiếng Việt cho người dùng.
 *   - Chọn đối tác không có công ty là hành vi MONG ĐỢI khi tạo mới (Owner
 *     chốt ở round 33+): hợp đồng mới không thể lưu nếu thiếu công ty, đây
 *     là ràng buộc nghiệp vụ chứ không phải bug.
 *   - Công ty BẮT BUỘC khi tạo mới (`createContract` ở server kiểm tra và trả
 *     lỗi nếu rỗng), nhưng KHÔNG bắt buộc khi sửa hợp đồng cũ (round 33 đã
 *     duyệt quy tắc này).
 *   - Trường hợp chỉnh sửa: hợp đồng tạo trước round 33 có `company_id = null`
 *     (hiển thị rỗng, vẫn lưu được); hợp đồng đã gán công ty mà công ty đó
 *     không thuộc đối tác hiện tại vẫn phải hiển thị đúng giá trị đã chọn —
 *     cách làm giống `selectedPartner`: ép một dòng "ảo" chỉ mang id và tên
 *     (gọi qua action danh sách công ty của đối tác, không phải toàn bộ
 *     công ty của tổ chức) để Select hiển thị nhãn đúng.
 */

type Phase = "idle" | "saving" | "uploading" | "done" | "failed";

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
  /** Resolved by `getContract`; tên công ty (round 33+) — dùng khi công ty
   *  không nằm trong danh sách công ty của đối tác đang chọn (giống cách
   *  `selectedPartner` giữ đối tác nằm ngoài trang đầu của combobox). */
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
    // Round 33 — a contract created before round 33 has no company; `?? ""`
    // keeps the Select on its placeholder instead of crashing on null.
    companyId: contract.company_id ?? "",
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

  /**
   * Round 33+ — công ty của đối tác đang chọn, tải lại mỗi khi `partnerId` đổi
   * (qua `useWatch` ở dưới + `useEffect`).
   *
   * Owner quyết định "ui_only": server không siết ràng buộc — đối tác chưa có
   * công ty → danh sách rỗng, Select disable, gợi ý cho người dùng. Hợp đồng
   * tạo mới BẮT BUỘC có công ty (`createContract` chặn ở service), nên người
   * dùng không thể lưu với đối tác chưa gán công ty — đây là hành vi mong đợi.
   *
   * Khi đổi đối tác: danh sách công ty cũ KHÔNG được giữ lại. Nếu công ty đang
   * chọn không thuộc danh sách mới → reset `companyId` về "" để form không giữ
   * trạng thái không hợp lệ. Trường hợp sửa hợp đồng cũ có `company_id` không
   * thuộc đối tác hiện tại được xử lý riêng bằng cách nối thêm công ty đó vào
   * danh sách hiển thị (xem `useEffect` bên dưới).
   *
   * Khi tải lỗi: hiện nút "Thử lại" (mẫu round 27) thay vì disable submit —
   * nếu không người dùng tạo mới sẽ bị chặn mà không thấy lý do.
   */
  const [companyRows, setCompanyRows] = useState<Company[]>([]);
  const [companiesError, setCompaniesError] = useState<string | null>(null);
  const [companiesRetry, setCompaniesRetry] = useState(0);

  // `useWatch` thay vì `form.watch()`: cái sau trả về function không memoizable
  // và React Compiler không tối ưu quanh nó được (mẫu có sẵn ở `signedDate` /
  // `expiryDate` ngay phía dưới).
  const partnerId = useWatch({ control: form.control, name: "partnerId" });

  /**
   * Đối tác mà `companyRows` đang phản ánh. Dùng để (a) suy ra trạng thái
   * đang tải mà không cần `setState` trong effect, và (b) loại bỏ dữ liệu của
   * đối tác cũ ngay khi người dùng đổi đối tác — danh sách công ty của đối tác
   * trước KHÔNG được giữ lại.
   */
  const [rowsPartnerId, setRowsPartnerId] = useState<string | null>(null);

  // Đối tác đổi nhưng dữ liệu cũ chưa được tải xong → đang tải.
  const companiesLoading = Boolean(partnerId) && rowsPartnerId !== partnerId;

  useEffect(() => {
    // Chưa chọn đối tác → không gọi server. Tránh query vô ích cho đối tác "".
    if (!partnerId) return;

    let active = true;
    partnerCompanyRowsAction(partnerId)
      .then((result) => {
        if (!active) return;
        setRowsPartnerId(partnerId);

        if (!result.ok) {
          setCompanyRows([]);
          setCompaniesError(result.message || "Không tải được danh sách công ty");
          return;
        }
        setCompaniesError(null);
        let next = result.data;

        // Hợp đồng cũ có `company_id` không thuộc đối tác hiện tại: ghép thêm
        // một dòng {id, name} để Select hiển thị đúng nhãn, giống cách
        // `selectedPartner` xử lý đối tác nằm ngoài trang đầu của combobox.
        // Tên công ty đã có sẵn từ `EditableContract` (server trả về qua
        // `getContract`); nếu thiếu tên thì chèn placeholder "" để Select vẫn
        // hiện được id đang chọn thay vì rỗng.
        if (isEdit && contract?.company_id) {
          const currentId = contract.company_id;
          const stillPresent = next.some((row) => row.id === currentId);
          if (!stillPresent) {
            next = [
              ...next,
              { id: currentId, name: contract.company_name ?? "" },
            ];
          }
        }

        setCompanyRows(next);

        // Nếu công ty đang chọn không còn thuộc danh sách mới → reset về ""
        // để form không giữ trạng thái không hợp lệ. Chỉ áp dụng khi KHÔNG
        // phải edit hợp đồng cũ có id nằm ngoài danh sách (vì trường hợp đó
        // đã được xử lý ở nhánh `stillPresent === false` ở trên).
        const currentCompanyId = form.getValues("companyId");
        if (
          currentCompanyId &&
          !next.some((row) => row.id === currentCompanyId)
        ) {
          form.setValue("companyId", "", { shouldDirty: false, shouldValidate: false });
        }
      })
      .catch(() => {
        if (!active) return;
        setRowsPartnerId(partnerId);
        setCompanyRows([]);
        setCompaniesError("Không tải được danh sách công ty. Vui lòng thử lại.");
      });
    return () => {
      active = false;
    };
  }, [partnerId, companiesRetry, isEdit, form, contract?.company_id, contract?.company_name]);

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

      {/* Round 33+ — công ty ký hợp đồng. Đặt NGAY DƯỚI ô "Đối tác", thay cho
          badge round 32 nằm trong combobox. Danh sách công ty phụ thuộc vào
          đối tác đang chọn (xem `useEffect` ở trên). */}
      <FormField
        control={form.control}
        name="companyId"
        rules={{
          validate: (value) => {
            // Hợp đồng MỚI bắt buộc chọn công ty (quyết định Owner round 33+).
            // Hợp đồng CŨ (tạo trước round 33, `company_id IS NULL`) vẫn sửa
            // được, không bị ép phải có công ty.
            if (isEdit) return true;
            return value && value.length > 0 ? true : "Vui lòng chọn công ty";
          },
        }}
        render={({ field }) => {
          const noPartnerChosen = !partnerId;
          const partnerHasNoCompany =
            !companiesError &&
            !noPartnerChosen &&
            !companiesLoading &&
            companyRows.length === 0;
          // Loading: Select hiển thị nhưng disabled để khỏi cho user bấm vào
          // danh sách rỗng khi server chưa trả lời.
          const selectDisabled =
            busy || noPartnerChosen || companiesLoading || partnerHasNoCompany;

          return (
            <FormItem>
              <FormLabel>Công ty</FormLabel>
              {companiesError ? (
                <Alert
                  variant="destructive"
                  data-testid="contract-companies-error"
                >
                  <AlertTitle>Không tải được danh sách công ty</AlertTitle>
                  <AlertDescription className="flex items-center gap-2">
                    <span>{companiesError}</span>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setCompaniesError(null);
                        setCompaniesRetry((n) => n + 1);
                      }}
                      data-testid="contract-companies-retry"
                    >
                      Thử lại
                    </Button>
                  </AlertDescription>
                </Alert>
              ) : (
                <>
                  <Select
                    value={field.value ?? ""}
                    onValueChange={field.onChange}
                    disabled={selectDisabled}
                  >
                    <FormControl>
                      <SelectTrigger
                        id="companyId"
                        data-testid="contract-company-select"
                        aria-invalid={
                          form.formState.errors.companyId ? true : undefined
                        }
                      >
                        <SelectValue placeholder="Chọn công ty" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {/* Chỉ hiện dữ liệu của đối tác HIỆN TẠI. Trong lúc
                          chờ server, `companyRows` còn là dữ liệu đối tác cũ —
                          không được render ra để tránh hiện nhầm công ty. */}
                      {(companiesLoading ? [] : companyRows).map((company) => (
                        <SelectItem key={company.id} value={company.id}>
                          {company.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {noPartnerChosen ? (
                    <FormDescription data-testid="contract-companies-hint">
                      Hãy chọn đối tác trước để xem công ty được liên kết.
                    </FormDescription>
                  ) : companiesLoading ? (
                    <FormDescription data-testid="contract-companies-loading">
                      Đang tải danh sách công ty…
                    </FormDescription>
                  ) : partnerHasNoCompany ? (
                    <FormDescription data-testid="contract-companies-hint">
                      Đối tác này chưa được gán công ty. Hãy gán công ty cho
                      đối tác ở trang Đối tác.
                    </FormDescription>
                  ) : null}
                </>
              )}
              <FormDescription>
                {isEdit
                  ? "Công ty ký hợp đồng. Hợp đồng cũ chưa có công ty vẫn sửa được."
                  : "Chọn công ty ký hợp đồng."}
              </FormDescription>
              <FormMessage />
            </FormItem>
          );
        }}
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
