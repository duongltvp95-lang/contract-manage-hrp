"use client";

import { useState } from "react";
import type { FileKind } from "@schemas/file";
import { completeUploadAction } from "@/app/(app)/contracts/actions";
import { putFileWithProgress, type PendingFile } from "@/lib/upload";

export type Phase = "idle" | "saving" | "uploading" | "done" | "failed";

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

  function mergeFiles(kind: FileKind, next: PendingFile[]) {
    setFiles((current) => [
      ...current.filter((item) => item.kind !== kind),
      ...next,
    ]);
  }

  async function uploadOne(contractId: string, pending: PendingFile) {
    patchFile(pending.id, { status: "uploading", progress: 0, error: undefined });

    // 1. Ask the server for a presigned PUT (authorization happens there)
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

    // 2. Upload the bytes straight to R2
    await putFileWithProgress(uploadUrl, pending.file, {
      contentType: pending.file.type,
      onProgress: (progress) => patchFile(pending.id, { progress: progress.percent }),
    });

    patchFile(pending.id, { fileId, objectKey, progress: 100 });

    // 3. Persist the metadata row
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
      onSuccess(contractId);
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

  const failedCount = files.filter((item) => item.status === "error").length;
  const hasFiles = files.length > 0;
  const busy = phase === "saving" || phase === "uploading";

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
    mergeFiles,
    runUploads,
    retryUploads,
  };
}
