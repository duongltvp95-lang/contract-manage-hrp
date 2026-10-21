"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";

import {
  CreateContractSchema,
  getContractWarnings,
  type CreateContractInput,
  type MatchedBaseContract,
} from "@schemas/contract";
import {
  AI_DIRECT_ACTION_MAX_BYTES,
  MAX_AI_FILE_SIZE_BYTES,
  MAX_AI_FILE_SIZE_MB,
} from "@schemas/file";

import {
  completeUploadAction,
  createContractAction,
  extractContractAction,
  updateContractAction,
} from "@/app/(app)/contracts/actions";
import {
  inferFileKindFromFilename,
  putFileWithProgress,
  requestContractUploadUrl,
  resolveUploadMimeType,
  type PendingFile,
} from "@/lib/upload";
import { formatDateOnly } from "@/lib/format";
import { isInternalCompanyId, getInternalCompanyName } from "@/lib/companies";
import { clientLog } from "@/lib/ai/log-client";
import { calculateExpiryDateFromDuration } from "@/lib/ai/matching";
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

function isAppendixFile(file: PendingFile) {
  return file.kind === "appendix" || file.aiDocumentType === "appendix";
}

function hasMatchingMainContractFile(files: PendingFile[], contractNumber?: string) {
  const normalizedNumber = (contractNumber ?? "").trim().toLocaleLowerCase();
  if (!normalizedNumber) return false;

  return files.some(
    (file) =>
      file.kind === "document" &&
      file.aiDocumentType !== "appendix" &&
      file.aiContractNumber?.trim().toLocaleLowerCase() === normalizedNumber,
  );
}

function isAppendixSaveBlocked(
  files: PendingFile[],
  contractNumber?: string,
  appendixNotice?: {
    type: "found" | "not_found";
    baseContractNumber: string;
    file: PendingFile;
  } | null,
) {
  const appendixFiles = files.filter(isAppendixFile);
  const normalizedContractNumber = (contractNumber ?? "").trim().toLocaleLowerCase();
  const hasAppendix = appendixFiles.length > 0 || Boolean(appendixNotice);

  // Không có tệp phụ lục nào thì không bị chặn bởi logic phụ lục
  if (!hasAppendix) {
    return false;
  }

  // 1. Phụ lục thuộc hợp đồng đã có sẵn trong DB -> BẮT BUỘC KHÓA LƯU (phải dùng nút gán trực tiếp)
  if (appendixNotice?.type === "found" || appendixFiles.some((f) => Boolean(f.matchedBaseContractId))) {
    return true;
  }

  // 2. Không có tệp hợp đồng chính nào trong biểu mẫu -> BẮT BUỘC KHÓA LƯU (chưa có hợp đồng tải lên từ trước)
  const mainContractFiles = files.filter((f) => !isAppendixFile(f));
  if (mainContractFiles.length === 0) {
    return true;
  }

  // 3. Mỗi phụ lục phải có số HĐ gốc khớp với số HĐ chính trong biểu mẫu
  for (const appFile of appendixFiles) {
    const baseNum = (appFile.baseContractNumber || "").trim().toLocaleLowerCase();
    if (!baseNum || !normalizedContractNumber || baseNum !== normalizedContractNumber) {
      return true;
    }
    if (!hasMatchingMainContractFile(files, baseNum)) {
      return true;
    }
  }

  if (appendixNotice?.type === "not_found") {
    const noticeBase = appendixNotice.baseContractNumber.trim().toLocaleLowerCase();
    if (
      !noticeBase ||
      !normalizedContractNumber ||
      noticeBase !== normalizedContractNumber ||
      !hasMatchingMainContractFile(files, noticeBase)
    ) {
      return true;
    }
  }

  return false;
}

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
  const companyId = useWatch({ control: form.control, name: "companyId" });

  const handleResetCompany = useCallback(() => {
    const current = form.getValues("companyId");
    if (isInternalCompanyId(current)) {
      return;
    }
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
    currentCompanyId: companyId,
    onResetCompany: handleResetCompany,
    extraCompany,
  });

  const resetFormStateRef = useRef<() => void>(() => {});

  // Hook quản lý tải tệp hợp đồng lên R2
  const {
    files,
    setFiles,
    phase,
    setPhase,
    uploadError,
    setUploadError,
    setSavedContractId,
    failedCount,
    hasFiles,
    busy,
    toggleFileKind,
    setFileClassification,
    removeFileById,
    runUploads,
    retryUploads,
    resetUploads,
    savedContractId,
  } = useContractUploads({
    onSuccess: (contractId) => {
      toast.success("Đã tạo hợp đồng thành công!", {
        description: "Dữ liệu và tệp đính kèm đã được lưu. Bạn có thể tiếp tục thêm hợp đồng mới.",
        action: {
          label: "Xem hợp đồng",
          onClick: () => router.push(`/contracts/${contractId}`),
        },
        duration: 8000,
      });
      resetFormStateRef.current();
      if (typeof window !== "undefined") {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }
    },
  });

  const [formError, setFormError] = useState<string | null>(null);
  const [isExtractingAi, setIsExtractingAi] = useState(false);
  const [isAiBatchRunning, setIsAiBatchRunning] = useState(false);
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiPartnerSuggestion, setAiPartnerSuggestion] = useState<{
    name: string;
    address?: string;
    taxCode?: string;
  } | null>(null);
  const [appendixNotice, setAppendixNotice] = useState<{
    type: "found" | "not_found";
    baseContractNumber: string;
    baseContract?: MatchedBaseContract | null;
    file: PendingFile;
  } | null>(null);
  const [isAttachingToExisting, setIsAttachingToExisting] = useState(false);
  const cancelAiBatchRef = useRef(false);
  const aiRateLimitHitRef = useRef(false);

  const resetFormState = useCallback(() => {
    form.reset(EMPTY_VALUES);
    setExtraCompany(null);
    setAiSummary(null);
    setAiPartnerSuggestion(null);
    setFormError(null);
    setAppendixNotice(null);
    resetUploads();
  }, [form, resetUploads]);

  useEffect(() => {
    resetFormStateRef.current = resetFormState;
  }, [resetFormState]);

  // Xử lý khi người dùng quay lại bằng nút Back / Forward của trình duyệt (BFCache / PopState)
  useEffect(() => {
    function handlePageShow(event: PageTransitionEvent) {
      if (event.persisted) {
        resetFormState();
      }
    }

    function handlePopState() {
      if (!isEdit) {
        resetFormState();
      }
    }

    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [isEdit, resetFormState]);

  // Nếu quay lại trang tạo mới mà hợp đồng trước đó đã được lưu thành công thì tự động làm sạch form
  useEffect(() => {
    if (!isEdit && savedContractId) {
      const timer = setTimeout(() => {
        resetFormState();
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [isEdit, savedContractId, resetFormState]);

  async function handleAttachToExistingContract(baseContractId: string, fileItem: PendingFile) {
    setIsAttachingToExisting(true);
    toast.loading("Đang gán phụ lục vào hợp đồng...", { id: "attach-appendix" });
    try {
      const rawFile = fileItem.file;
      const mimeType = resolveUploadMimeType(rawFile);
      if (!mimeType || mimeType !== "application/pdf") {
        throw new Error("Phụ lục phải là tệp PDF hợp lệ.");
      }
      const { fileId, objectKey, uploadUrl } = await requestContractUploadUrl({
        contractId: baseContractId,
        filename: rawFile.name,
        mimeType,
        fileSize: rawFile.size,
        kind: "appendix",
      });

      await putFileWithProgress(uploadUrl, rawFile, {
        contentType: mimeType,
        onProgress: (p) => {
          toast.loading(`Đang tải phụ lục lên: ${p.percent}%...`, { id: "attach-appendix" });
        },
      });

      const completeRes = await completeUploadAction({
        contractId: baseContractId,
        fileId,
        objectKey,
        filename: rawFile.name,
        mimeType,
        fileSize: rawFile.size,
        kind: "appendix",
      });

      if (!completeRes.ok) {
        throw new Error(completeRes.message);
      }

      removeFileById(fileItem.id);
      setAppendixNotice(null);

      toast.success(`Đã thêm phụ lục "${rawFile.name}" vào hợp đồng thành công!`, {
        id: "attach-appendix",
        action: {
          label: "Xem hợp đồng",
          onClick: () => router.push(`/contracts/${baseContractId}`),
        },
        duration: 8000,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Gán phụ lục thất bại. Vui lòng thử lại.";
      toast.error("Không thể gán phụ lục vào hợp đồng", {
        id: "attach-appendix",
        description: msg,
        duration: 8000,
      });
    } finally {
      setIsAttachingToExisting(false);
    }
  }

  async function executeExtraction(
    fileItem: PendingFile,
    options?: { suppressIndividualSuccessToast?: boolean },
  ) {
    if (fileItem.file.size > MAX_AI_FILE_SIZE_BYTES) {
      toast.error(`Dung lượng tệp vượt quá giới hạn ${MAX_AI_FILE_SIZE_MB} MB cho phép đối với phân tích AI.`, {
        id: "ai-extract",
      });
      return null;
    }

    const clientStartedAt = Date.now();
    const traceId = crypto.randomUUID();
    try {
      const formData = new FormData();
      formData.append("traceId", traceId);

      // Tệp trên ngưỡng payload trực tiếp được tải lên Cloudflare R2
      // để giữ request Server Action nhỏ và xử lý tệp lớn theo luồng R2.
      if (fileItem.file.size > AI_DIRECT_ACTION_MAX_BYTES) {
        toast.loading(`Đang chuẩn bị tệp "${fileItem.file.name}"...`, { id: "ai-extract" });

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

        const uploadStartedAt = Date.now();
        await putFileWithProgress(uploadUrl, fileItem.file, {
          contentType: targetMime,
          onProgress: (p) => {
            toast.loading(`Đang tải lên "${fileItem.file.name}": ${p.percent}%...`, { id: "ai-extract" });
          },
        });
        formData.append("clientR2UploadMs", String(Date.now() - uploadStartedAt));

        formData.append("objectKey", objectKey);
        formData.append("filename", fileItem.file.name);
        formData.append("mimeType", targetMime);
      } else {
        formData.append("file", fileItem.file);
      }

      toast.loading(`AI đang đọc nội dung "${fileItem.file.name}"...`, { id: "ai-extract" });
      const result = await extractContractAction(formData);
      clientLog.info("Hoàn tất yêu cầu trích xuất AI", {
        traceId,
        outcome: result.ok ? "success" : "error",
        elapsedMs: Date.now() - clientStartedAt,
        sizeBytes: fileItem.file.size,
        source: formData.has("objectKey") ? "r2" : "server-action",
      });

      if (!result.ok) {
        if (result.code === "rate_limited" || result.code === "rate_limit_unavailable") {
          aiRateLimitHitRef.current = true;
        }
        toast.error("Không thể trích xuất thông tin bằng AI", {
          description: result.message,
          duration: 6000,
        });
        return null;
      }

      const data = result.data;
      const filledFields: string[] = [];

      const isAppendixDoc = data.documentType === "appendix" || Boolean(data.baseContractNumber);
      const currentFormNum = form.getValues("contractNumber")?.trim() ?? "";
      const baseNum = data.baseContractNumber?.trim() || data.contractNumber?.trim() || "Không xác định";

      if (isAppendixDoc) {
        setFileClassification(fileItem.id, "appendix", {
          baseContractNumber: data.baseContractNumber?.trim() || undefined,
          matchedBaseContractId: data.matchedBaseContract?.id,
        });

        // Kiểm tra xem trong biểu mẫu đã có tệp hợp đồng chính nào khớp số HĐ gốc chưa
        const hasMainInFiles = files.some(
          (f) => f.id !== fileItem.id && !isAppendixFile(f),
        );
        const isMatchedWithCurrentForm =
          currentFormNum.length > 0 &&
          hasMainInFiles &&
          baseNum.toLowerCase() === currentFormNum.toLowerCase();

        if (data.matchedBaseContract) {
          setAppendixNotice({
            type: "found",
            baseContractNumber: baseNum,
            baseContract: data.matchedBaseContract,
            file: fileItem,
          });
        } else if (isMatchedWithCurrentForm) {
          setAppendixNotice(null);
          if (!options?.suppressIndividualSuccessToast) {
            toast.info(
              `Tệp "${fileItem.file.name}" là Phụ lục của Hợp đồng "${currentFormNum}" trong biểu mẫu. Tệp sẽ được lưu cùng hợp đồng này.`,
              { duration: 7000 },
            );
          }
        } else {
          setAppendixNotice({
            type: "not_found",
            baseContractNumber: baseNum,
            baseContract: null,
            file: fileItem,
          });
          const blockMsg = `Tệp "${fileItem.file.name}" là Phụ lục của hợp đồng "${baseNum}". Hệ thống chưa có hợp đồng gốc này được tải lên từ trước, không thể lưu hợp đồng khi chưa có hợp đồng gốc.`;
          setFormError(blockMsg);
        }
      } else {
        setFileClassification(fileItem.id, "document", {
          contractNumber: data.contractNumber,
        });
        setAppendixNotice((current) => current?.type === "found" ? current : null);
      }

      // CHỈ điền thông tin hợp đồng vào biểu mẫu nếu tệp này là HỢP ĐỒNG CHÍNH.
      // Nếu là phụ lục mà chưa có hợp đồng gốc thì TUYỆT ĐỐI không điền để tránh tạo hợp đồng mới trái phép.
      if (!isAppendixDoc && data.contractNumber) {
        form.setValue("contractNumber", data.contractNumber, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push("Số HĐ");
      }

      if (!isAppendixDoc && data.signedDate && !form.getValues("signedDate")) {
        form.setValue("signedDate", data.signedDate, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push("Ngày ký");
      }

      let calculatedExpiry = data.expiryDate;
      if (!calculatedExpiry && data.signedDate && data.durationText) {
        calculatedExpiry = calculateExpiryDateFromDuration(data.signedDate, data.durationText);
      }

      if (!isAppendixDoc && calculatedExpiry && !form.getValues("expiryDate")) {
        form.setValue("expiryDate", calculatedExpiry, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push("Ngày hết hạn");
      }

      if (!isAppendixDoc && data.durationText && !form.getValues("durationText")) {
        form.setValue("durationText", data.durationText, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push("Thời hạn");
      }

      if (!isAppendixDoc && data.matchedCompanyId && !form.getValues("companyId")) {
        const companyName =
          data.matchedCompanyName ||
          getInternalCompanyName(data.matchedCompanyId) ||
          "HR VN";

        setExtraCompany({
          id: data.matchedCompanyId,
          name: companyName,
        });

        form.setValue("companyId", data.matchedCompanyId, {
          shouldValidate: true,
          shouldDirty: true,
        });
        filledFields.push(`Công ty: ${companyName}`);
      }

      if (
        !isAppendixDoc &&
        data.matchedPartnerId &&
        data.matchedPartnerName &&
        !form.getValues("partnerId")
      ) {
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
        setAiPartnerSuggestion(null);

        filledFields.push(`Đối tác: ${data.matchedPartnerName}`);
      } else if (
        !isAppendixDoc &&
        data.partnerName?.trim() &&
        !form.getValues("partnerId")
      ) {
        setAiPartnerSuggestion({
          name: data.partnerName.trim(),
          address: data.partnerAddress?.trim() || undefined,
          taxCode: data.partnerTaxCode?.trim() || undefined,
        });
        filledFields.push(`Đối tác cần xác nhận: ${data.partnerName.trim()}`);
      }

      if (data.summary) {
        setAiSummary(data.summary);
      }

      if (data.isDuplicate && !isAppendixDoc) {
        const signedDisp = data.signedDate ? formatDateOnly(data.signedDate) : "trống";
        const expiryDisp = data.expiryDate ? formatDateOnly(data.expiryDate) : "trống";
        const dupMsg = `Hợp đồng số "${data.contractNumber}" (ngày ký: ${signedDisp}, hết hạn: ${expiryDisp}) đã tồn tại trong hệ thống. Vui lòng không thêm trùng lặp.`;
        setFormError(dupMsg);
        toast.warning("Hợp đồng này đã tồn tại trong hệ thống!", {
          description: dupMsg,
          duration: 8000,
        });
      }

      if (!options?.suppressIndividualSuccessToast) {
        if (isAppendixDoc) {
          if (data.matchedBaseContract) {
            toast.info("✨ AI nhận diện Phụ lục & tìm thấy Hợp đồng gốc!", {
              description: `Tệp là phụ lục của Hợp đồng "${data.matchedBaseContract.contractNumber}". Bấm nút "Gán ngay vào Hợp đồng" để đính kèm.`,
              duration: 8000,
            });
          } else {
            toast.warning("Chưa có hợp đồng gốc để gán phụ lục", {
              description: `Tệp được nhận diện là Phụ lục của hợp đồng "${baseNum}". Hệ thống chưa có hợp đồng gốc này được tải lên từ trước, chưa thể lưu hợp đồng.`,
              duration: 9000,
            });
          }
        } else {
          let toastTitle = "✨ AI đã trích xuất thành công thông tin hợp đồng!";
          if (aiPartnerSuggestion || (!data.matchedPartnerId && data.partnerName)) {
            toastTitle = "✨ AI đã trích xuất — hãy xác nhận đối tác";
          }
          const toastDesc = filledFields.length > 0
            ? `Đã điền: ${filledFields.join(", ")}.`
            : "Đã phân tích xong nội dung tệp đính kèm.";
          toast.success(toastTitle, {
            description: toastDesc,
            duration: 5000,
          });
        }
      }

      return data;
    } catch (err) {
      clientLog.error("executeExtraction thất bại", {
        traceId,
        elapsedMs: Date.now() - clientStartedAt,
        sizeBytes: fileItem.file.size,
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      const rawMsg = err instanceof Error ? err.message : String(err);
      const isFetchErr =
        rawMsg.toLowerCase().includes("fetch") ||
        rawMsg.toLowerCase().includes("network") ||
        rawMsg.toLowerCase().includes("timeout");
      const userFriendlyMsg = isFetchErr
        ? "Kết nối tới máy chủ AI bị gián đoạn hoặc xử lý tệp lớn quá thời gian chờ. Bạn vui lòng thử lại hoặc tải tệp có dung lượng gọn hơn."
        : rawMsg || "Vui lòng thử lại sau.";
      toast.error("Trích xuất AI gặp sự cố", {
        description: userFriendlyMsg,
        duration: 8000,
      });
      return null;
    }
  }

  async function handleExtractAi(fileItem: PendingFile) {
    setIsExtractingAi(true);
    setAiSummary(null);
    try {
      await executeExtraction(fileItem);
    } finally {
      toast.dismiss("ai-extract");
      setIsExtractingAi(false);
    }
  }

  async function handleExtractAllAi(fileItems: PendingFile[]) {
    if (fileItems.length === 0) return;
    if (fileItems.length === 1) {
      await handleExtractAi(fileItems[0]);
      return;
    }

    setIsExtractingAi(true);
    setIsAiBatchRunning(true);
    setAiSummary(null);
    cancelAiBatchRef.current = false;
    aiRateLimitHitRef.current = false;

    // Ưu tiên chạy tệp Hợp đồng chính trước (để điền thông tin hợp đồng vào form), sau đó chạy các Phụ lục
    const sorted = [...fileItems].sort((a, b) => {
      const aIsApp = a.kind === "appendix" || inferFileKindFromFilename(a.file.name) === "appendix";
      const bIsApp = b.kind === "appendix" || inferFileKindFromFilename(b.file.name) === "appendix";
      if (aIsApp === bIsApp) return 0;
      return aIsApp ? 1 : -1;
    });

    let contractCount = 0;
    let appendixCount = 0;
    let processedCount = 0;
    let stopped = false;
    let stoppedForRateLimit = false;

    try {
      for (let i = 0; i < sorted.length; i++) {
        const item = sorted[i];
        toast.loading(`AI đang phân tích tệp ${i + 1}/${sorted.length}: "${item.file.name}"...`, {
          id: "ai-extract",
        });
        const res = await executeExtraction(item, { suppressIndividualSuccessToast: true });
        processedCount++;
        if (res?.documentType === "appendix") {
          appendixCount++;
        } else if (res) {
          contractCount++;
        }
        if (aiRateLimitHitRef.current) {
          stopped = true;
          stoppedForRateLimit = true;
          break;
        }
        if (cancelAiBatchRef.current) {
          stopped = true;
          break;
        }
      }
    } finally {
      setIsExtractingAi(false);
      setIsAiBatchRunning(false);
      toast.dismiss("ai-extract");
    }

    cancelAiBatchRef.current = false;
    if (stoppedForRateLimit) return;
    toast.success(stopped ? `Đã dừng batch sau ${processedCount}/${sorted.length} tệp` : `✨ Đã phân tích xong ${sorted.length} tệp!`, {
      description: `Phân loại trong batch: ${contractCount} Hợp đồng chính, ${appendixCount} Phụ lục.${stopped ? " Kết quả tệp đang xử lý đã được giữ lại." : ""}`,
      duration: 8000,
    });
  }

  function cancelAiBatchAfterCurrentFile() {
    cancelAiBatchRef.current = true;
    toast.info("Sẽ dừng sau khi AI xử lý xong tệp hiện tại.", { id: "ai-extract" });
  }

  const contractNumber = useWatch({ control: form.control, name: "contractNumber" });
  const signedDate = useWatch({ control: form.control, name: "signedDate" });
  const expiryDate = useWatch({ control: form.control, name: "expiryDate" });
  const appendixFiles = files.filter(isAppendixFile);
  const appendixSaveBlocked = isAppendixSaveBlocked(files, contractNumber, appendixNotice);
  const warnings = getContractWarnings({ signedDate, expiryDate });

  useEffect(() => {
    if (formError && formError.includes("đã tồn tại trong hệ thống")) {
      const timer = setTimeout(() => {
        setFormError(null);
      }, 0);
      return () => clearTimeout(timer);
    }
  }, [contractNumber, signedDate, expiryDate, formError]);

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

    if (isAppendixSaveBlocked(files, values.contractNumber, appendixNotice)) {
      const message =
        "Không thể lưu: Tệp tải lên là Phụ lục nhưng chưa có hợp đồng gốc được tải lên hệ thống từ trước. Vui lòng tạo và lưu hợp đồng gốc trước khi thêm phụ lục.";
      setFormError(message);
      toast.error("Không thể lưu phụ lục khi thiếu hợp đồng gốc", { description: message });
      return;
    }

    setFormError(null);
    setUploadError(null);
    setPhase("saving");

    const created = await createContractAction(
      values,
      files.map((file) => ({
        kind: file.kind,
        aiDocumentType: file.aiDocumentType,
        baseContractNumber: file.baseContractNumber,
        aiContractNumber: file.aiContractNumber,
        matchedBaseContractId: file.matchedBaseContractId,
      })),
    );

    if (!created.ok) {
      setFormError(created.message);
      toast.error("Không thể lưu hợp đồng", {
        description: created.message,
      });
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
                onChange={(value) => {
                  field.onChange(value);
                  setAiPartnerSuggestion(null);
                }}
                partners={partnerOptions}
                selectedPartner={selectedPartner}
                onPartnerCreated={addPartnerOption}
                aiSuggestion={aiPartnerSuggestion ?? undefined}
                disabled={busy}
                invalid={Boolean(form.formState.errors.partnerId)}
              />
            </FormControl>
            {aiPartnerSuggestion && !partnerId ? (
              <FormDescription>
                AI đề xuất đối tác “{aiPartnerSuggestion.name}”. Hãy chọn đối tác có sẵn hoặc bấm “Thêm đối tác” để xác nhận và lưu vào danh bạ.
              </FormDescription>
            ) : null}
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
              onChange={(nextDate) => {
                field.onChange(nextDate);
                const currentDuration = form.getValues("durationText");
                const currentExpiry = form.getValues("expiryDate");
                if (nextDate && !currentExpiry && currentDuration) {
                  const autoExpiry = calculateExpiryDateFromDuration(nextDate, currentDuration);
                  if (autoExpiry) {
                    form.setValue("expiryDate", autoExpiry, { shouldValidate: true, shouldDirty: true });
                  }
                }
              }}
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
                placeholder='VD: 6 tháng, 1 năm, 2 năm hoặc "Không xác định thời hạn"'
                disabled={busy}
                {...field}
                onBlur={(e) => {
                  field.onBlur();
                  const currentSigned = form.getValues("signedDate");
                  const currentExpiry = form.getValues("expiryDate");
                  const currentDuration = e.target.value;
                  if (currentSigned && !currentExpiry && currentDuration) {
                    const autoExpiry = calculateExpiryDateFromDuration(currentSigned, currentDuration);
                    if (autoExpiry) {
                      form.setValue("expiryDate", autoExpiry, { shouldValidate: true, shouldDirty: true });
                    }
                  }
                }}
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
            onFilesChange={setFiles}
            maxUploadSizeMb={maxUploadSizeMb}
            busy={busy}
            uploadError={uploadError}
            failedCount={failedCount}
            onRetryUploads={retryUploads}
            onExtractAi={handleExtractAi}
            onExtractAllAi={handleExtractAllAi}
            onCancelAiBatch={isAiBatchRunning ? cancelAiBatchAfterCurrentFile : undefined}
            isExtractingAi={isExtractingAi}
            onToggleFileKind={toggleFileKind}
            appendixNotice={appendixNotice}
            onAttachToExistingContract={handleAttachToExistingContract}
            isAttachingToExisting={isAttachingToExisting}
            appendixSaveBlocked={appendixSaveBlocked}
            appendixBaseNumbers={appendixFiles
              .map((file) => file.baseContractNumber)
              .filter((number): number is string => Boolean(number))}
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
          <Button
            type="submit"
            disabled={busy || isExtractingAi || (!isEdit && appendixSaveBlocked)}
            data-testid="contract-form-submit"
          >
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
                    : appendixSaveBlocked
                      ? "Chưa thể lưu (Cần hợp đồng gốc)"
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
