/**
 * Browser-side upload helpers.
 *
 * Client-only: uses `XMLHttpRequest` for genuine byte progress (plan section
 * 43 — no extra upload framework is needed just to get progress). Only import
 * this from a Client Component.
 */

import {
  ALLOWED_MIME_TYPES,
  type AllowedMimeType,
  type FileKind,
} from "@schemas/file";

export type PendingFileStatus = "pending" | "uploading" | "done" | "error";

export type PendingFile = {
  /** Stable local id for React keys — not the database file id. */
  id: string;
  file: File;
  status: PendingFileStatus;
  /** 0-100 */
  progress: number;
  error?: string;
  /** Round 16 — main document vs PDF appendix. */
  kind: FileKind;
  /** AI classification is tracked separately so a later UI update cannot lose a detected appendix. */
  aiDocumentType?: FileKind;
  /** AI-read contract number for a confirmed main-contract document. */
  aiContractNumber?: string;
  /** AI-extracted parent contract metadata used to validate appendix pairing before save. */
  baseContractNumber?: string;
  matchedBaseContractId?: string;
  /** Set once the server has reserved the object key. */
  fileId?: string;
  objectKey?: string;
};

export type UploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

/**
 * Browsers and operating systems sometimes leave File.type empty or report a
 * non-standard PDF/JPEG MIME. Prefer a supported declared type, then fall back
 * to the file extension so presign, PUT, and DB metadata use one value.
 */
export function resolveUploadMimeType(
  file: Pick<File, "name" | "type">,
): AllowedMimeType | null {
  const declaredType = file.type.trim().toLowerCase();
  const declaredAllowedType = ALLOWED_MIME_TYPES.find((mimeType) => mimeType === declaredType);
  if (declaredAllowedType) return declaredAllowedType;

  const filename = file.name.toLowerCase();
  if (filename.endsWith(".pdf")) return "application/pdf";
  if (filename.endsWith(".png")) return "image/png";
  if (/\.jpe?g$/.test(filename)) return "image/jpeg";
  return null;
}

export type ContractUploadRequest = {
  contractId: string;
  filename: string;
  mimeType: AllowedMimeType;
  fileSize: number;
  kind: FileKind;
};

export type ContractUploadUrl = {
  fileId: string;
  objectKey: string;
  uploadUrl: string;
};

/** Retry only transient presign failures; the endpoint has no persistent side effects. */
export async function requestContractUploadUrl(
  input: ContractUploadRequest,
  maxAttempts = 2,
): Promise<ContractUploadUrl> {
  const attempts = Number.isFinite(maxAttempts) ? Math.max(1, Math.trunc(maxAttempts)) : 2;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response: Response;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20_000);
    try {
      response = await fetch("/api/files/upload-url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (attempt >= attempts) {
        throw new Error(
          error instanceof Error
            ? `Không kết nối được tới dịch vụ tạo URL tải lên: ${error.message}`
            : "Không kết nối được tới dịch vụ tạo URL tải lên",
        );
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 500 * attempt));
      continue;
    }
    clearTimeout(timeoutId);

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.error ?? `Không lấy được URL tải lên (HTTP ${response.status})`;
      const retryable = response.status === 408 || response.status === 429 || response.status >= 500;
      if (retryable && attempt < attempts) {
        await new Promise<void>((resolve) => setTimeout(resolve, 500 * attempt));
        continue;
      }
      throw new Error(message);
    }

    const payload = (await response.json()) as Partial<ContractUploadUrl>;
    if (!payload.fileId || !payload.objectKey || !payload.uploadUrl) {
      throw new Error("Dịch vụ không trả về đủ thông tin URL tải lên.");
    }
    return payload as ContractUploadUrl;
  }

  throw new Error("Không thể tạo URL tải lên sau nhiều lần thử.");
}

/**
 * PUTs one file straight to R2 and reports real progress.
 *
 * `contentType` is part of the presigned signature, so it must match exactly
 * what `createUploadUrl()` signed or R2 answers 403.
 */
export function putFileWithProgress(
  url: string,
  file: File,
  options: {
    contentType: string;
    onProgress?: (progress: UploadProgress) => void;
    timeoutMs?: number;
    maxAttempts?: number;
  },
): Promise<void> {
  const configuredAttempts = options.maxAttempts ?? 2;
  const maxAttempts = Number.isFinite(configuredAttempts)
    ? Math.max(1, Math.trunc(configuredAttempts))
    : 2;
  const timeoutMs = options.timeoutMs ?? 5 * 60 * 1000;

  const putOnce = () => new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", url, true);
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Content-Type", options.contentType);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      options.onProgress?.({
        loaded: event.loaded,
        total: event.total,
        percent: Math.round((event.loaded / event.total) * 100),
      });
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve();
      } else {
        reject(new Error(`R2 từ chối tải lên (HTTP ${xhr.status})`));
      }
    };

    xhr.onerror = () => reject(new Error("Không kết nối được tới R2"));
    xhr.onabort = () => reject(new Error("Đã huỷ tải lên"));
    xhr.ontimeout = () => reject(new Error("Tải tệp lên R2 quá thời gian chờ"));

    xhr.send(file);
  });

  const isRetryable = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.match(/HTTP\s+(\d{3})/i)?.[1];
    if (status) {
      const code = Number(status);
      return code === 408 || code === 429 || code >= 500;
    }
    return message.includes("Không kết nối được tới R2") || message.includes("quá thời gian chờ");
  };

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  return (async () => {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        await putOnce();
        return;
      } catch (error) {
        if (attempt >= maxAttempts || !isRetryable(error)) throw error;
        options.onProgress?.({ loaded: 0, total: file.size, percent: 0 });
        await pause(500 * attempt);
      }
    }
  })();
}

export function inferFileKindFromFilename(filename: string): FileKind {
  const normalized = filename.toLowerCase();
  const appendixPatterns = [
    /(?:phu|phụ)[\s_\-]*(?:luc|lục)/i,
    /appendix/i,
    /addendum/i,
    /plhd/i,
    /\bpl\b/i,
    /pl[\-_0-9]/i,
    /(?:sua|sửa)[\s_\-]*(?:doi|đổi)/i,
    /(?:bo|bổ)[\s_\-]*sung/i,
    /(?:gia|gia)[\s_\-]*(?:han|hạn)/i,
  ];
  return appendixPatterns.some((pattern) => pattern.test(normalized)) ? "appendix" : "document";
}

export function newPendingFile(file: File, kind?: FileKind): PendingFile {
  const resolvedKind = kind ?? inferFileKindFromFilename(file.name);
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    status: "pending",
    progress: 0,
    kind: resolvedKind,
  };
}
