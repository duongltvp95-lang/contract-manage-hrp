"use client";

import { useCallback, useState } from "react";
import type { FileKind } from "@schemas/file";
import { completeUploadAction } from "@/app/(app)/contracts/actions";
import {
  putFileWithProgress,
  requestContractUploadUrl,
  resolveUploadMimeType,
  type PendingFile,
} from "@/lib/upload";

export type Phase = "idle" | "saving" | "uploading" | "redirecting" | "done" | "failed";

/**
 * Custom hook to manage contract file uploads, presigned URLs, and retry orchestrations.
 */
export function useContractUploads({
  onSuccess,
}: {
  onSuccess: (contractId: string) => void;
}) {
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [phase, setPhase] = useState<Phase>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [savedContractId, setSavedContractId] = useState<string | null>(null);

  function patchFile(id: string, patch: Partial<PendingFile>) {
    setFiles((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function toggleFileKind(id: string) {
    setFiles((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              kind: item.kind === "appendix" ? "document" : "appendix",
              fileId: undefined,
              objectKey: undefined,
              uploadReservation: undefined,
              progress: 0,
            }
          : item,
      ),
    );
  }

  function setFileClassification(
    id: string,
    kind: FileKind,
    metadata?: {
      contractNumber?: string;
      baseContractNumber?: string;
      matchedBaseContractId?: string;
      extractedPartnerName?: string | null;
      extractedCompanyName?: string | null;
      extractedPartnerId?: string | null;
      extractedCompanyId?: string | null;
      classificationConflict?: boolean;
    },
  ) {
    setFiles((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              kind,
              aiDocumentType: kind,
              aiContractNumber: kind === "document" ? metadata?.contractNumber?.trim() : undefined,
              baseContractNumber: kind === "appendix" ? metadata?.baseContractNumber : undefined,
              matchedBaseContractId: kind === "appendix" ? metadata?.matchedBaseContractId : undefined,
              extractedPartnerName: metadata?.extractedPartnerName ?? item.extractedPartnerName,
              extractedCompanyName: metadata?.extractedCompanyName ?? item.extractedCompanyName,
              extractedPartnerId: metadata?.extractedPartnerId ?? item.extractedPartnerId,
              extractedCompanyId: metadata?.extractedCompanyId ?? item.extractedCompanyId,
              classificationConflict: metadata?.classificationConflict ?? item.classificationConflict,
            }
          : item,
      ),
    );
  }

  function removeFileById(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
  }

  async function uploadOne(contractId: string, pending: PendingFile) {
    patchFile(pending.id, { status: "uploading", error: undefined });
    const mimeType = resolveUploadMimeType(pending.file);
    if (!mimeType) {
      throw new Error("Không xác định được định dạng tệp. Chỉ chấp nhận PDF, PNG hoặc JPG.");
    }

    let fileId = pending.fileId;
    let objectKey = pending.objectKey;
    let uploadReservation = pending.uploadReservation;

    // Nếu lần trước đã nhận reservation, thử complete trước. Nếu object chưa lên
    // R2 thì complete báo upload_incomplete và ta xin URL mới cho đúng reservation.
    if (fileId && objectKey && uploadReservation) {
      try {
        const persisted = await completeUploadAction({
          contractId,
          fileId,
          objectKey,
          uploadReservation,
          filename: pending.file.name,
          mimeType,
          fileSize: pending.file.size,
          kind: pending.kind,
          baseContractNumber: pending.baseContractNumber,
        });
        if (persisted.ok) {
          patchFile(pending.id, { status: "done" });
          return;
        }
      } catch {
        // Nếu complete chưa thành công, tiếp tục xin presigned URL và tải lại bên dưới
      }
    }

    // 1. Xin presigned PUT URL. Nếu đã có fileId cũ, truyền fileId để tái sử dụng đúng objectKey,
    // tránh sinh ra object rác mồ côi trên R2 khi thử lại.
    const presigned = await requestContractUploadUrl({
      contractId,
      filename: pending.file.name,
      mimeType,
      fileSize: pending.file.size,
      kind: pending.kind,
      fileId,
      uploadReservation,
      baseContractNumber: pending.kind === "appendix" ? pending.baseContractNumber : undefined,
    });

    fileId = presigned.fileId;
    objectKey = presigned.objectKey;
    uploadReservation = presigned.uploadReservation;
    // Persist the retry identity before starting the PUT. A timeout or tab-side
    // network error must not force the next attempt to create a fresh R2 key.
    patchFile(pending.id, { fileId, objectKey, uploadReservation });

    // 2. Upload the bytes straight to R2
    await putFileWithProgress(presigned.uploadUrl, pending.file, {
      contentType: mimeType,
      onProgress: (progress) => patchFile(pending.id, { progress: progress.percent }),
    });

    patchFile(pending.id, { fileId, objectKey, uploadReservation, progress: 100 });

    // 3. Persist the metadata row
    const persisted = await completeUploadAction({
      contractId,
      fileId,
      objectKey,
      uploadReservation,
      filename: pending.file.name,
      mimeType,
      fileSize: pending.file.size,
      kind: pending.kind,
      baseContractNumber: pending.kind === "appendix" ? pending.baseContractNumber : undefined,
    });

    if (!persisted.ok) {
      throw new Error(persisted.message);
    }

    patchFile(pending.id, { status: "done" });
  }

  async function runUploads(contractId: string, queue: PendingFile[]) {
    if (queue.length === 0) {
      if (typeof window !== "undefined") {
        try {
          sessionStorage.removeItem("hrp_pending_contract_upload");
        } catch {
          // ignore storage failure
        }
      }
      setPhase("idle");
      onSuccess(contractId);
      return;
    }

    setPhase("uploading");
    setUploadError(null);

    const failures: string[] = [];
    const retryQueue = queue.filter((item) => item.status === "pending" || item.status === "error");
    const uploadGroup = async (group: PendingFile[]) => {
      let nextIndex = 0;
      const uploadWorker = async () => {
        while (nextIndex < group.length) {
          const pending = group[nextIndex];
          if (!pending) return;
          nextIndex += 1;
          try {
            await uploadOne(contractId, pending);
          } catch (error) {
            const message = error instanceof Error ? error.message : "Tải lên thất bại";
            failures.push(`${pending.file.name}: ${message}`);
            patchFile(pending.id, { status: "error", error: message });
          }
        }
      };

      // Giới hạn số PUT đồng thời để tránh nghẽn mạng khi chọn nhiều PDF lớn.
      await Promise.all(
        Array.from({ length: Math.min(2, group.length) }, () => uploadWorker()),
      );
    };

    const documentQueue = retryQueue.filter((item) => item.kind === "document");
    const appendixQueue = retryQueue.filter((item) => item.kind === "appendix");
    await uploadGroup(documentQueue);

    if (failures.length === 0) {
      await uploadGroup(appendixQueue);
    } else if (appendixQueue.length > 0) {
      const message = "Tạm dừng tải phụ lục vì hợp đồng chính chưa tải lên thành công.";
      failures.push(message);
      appendixQueue.forEach((item) => patchFile(item.id, { status: "error", error: message }));
    }

    if (failures.length === 0) {
      if (typeof window !== "undefined") {
        try {
          sessionStorage.removeItem("hrp_pending_contract_upload");
        } catch {
          // ignore storage failure
        }
      }
      setPhase("idle");
      onSuccess(contractId);
      return;
    }

    setUploadError(failures.join("\n"));
    setPhase("failed");
  }

  async function retryUploads() {
    if (!savedContractId) return;
    const queue = files.filter(
      (item) => item.status === "pending" || item.status === "error",
    );
    await runUploads(savedContractId, queue);
  }

  const resetUploads = useCallback(() => {
    setFiles([]);
    setPhase("idle");
    setUploadError(null);
    setSavedContractId(null);
  }, []);

  const failedCount = files.filter((item) => item.status === "error").length;
  const hasFiles = files.length > 0;
  const busy = phase === "saving" || phase === "uploading" || phase === "redirecting";

  return {
    files,
    setFiles,
    phase,
    setPhase,
    uploadError,
    setUploadError,
    savedContractId,
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
  };
}
