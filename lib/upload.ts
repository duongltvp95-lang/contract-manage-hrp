/**
 * Browser-side upload helpers.
 *
 * Client-only: uses `XMLHttpRequest` for genuine byte progress (plan section
 * 43 — no extra upload framework is needed just to get progress). Only import
 * this from a Client Component.
 */

import type { FileKind } from "@schemas/file";

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
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();

    xhr.open("PUT", url, true);
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

    xhr.send(file);
  });
}

export function newPendingFile(file: File, kind: FileKind = "document"): PendingFile {
  return {
    id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    status: "pending",
    progress: 0,
    kind,
  };
}
