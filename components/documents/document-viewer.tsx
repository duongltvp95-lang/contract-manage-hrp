"use client";

import { FileQuestion, Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { DocumentSelector, type SelectableFile } from "@/components/documents/document-selector";
import { ImageViewer } from "@/components/documents/image-viewer";
import { PdfPanel } from "@/components/documents/pdf-panel";
import { ViewerErrorBoundary } from "@/components/documents/viewer-error-boundary";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/empty-state";
import {
  isImageMime,
  isPdfMime,
  msUntilRefresh,
  requestViewUrl,
  type ViewUrl,
} from "@/lib/view-url";

/**
 * Document viewer — plan sections 55, 59, 60.
 *
 * Owns "which file" and "which signed URL", and hands the URL to the matching
 * viewer. The URL is fetched from `/api/files/view-url`, never built here: R2 is
 * private, and the server is the only thing allowed to authorize (plan section
 * 73).
 *
 * Signed-URL refresh works two ways (plan section 60):
 *   - proactively, a minute before the signature expires;
 *   - reactively, when a viewer reports a load failure.
 * Both just bump an attempt counter, so there is one code path.
 *
 * Page and zoom live inside the viewers and are keyed by URL, so a refresh does
 * not reset them.
 */

/** How many automatic retries a file gets before we stop and show the error. */
const MAX_AUTO_RETRIES = 2;

export function DocumentViewer({
  files,
  initialViewUrl = null,
  initialSelectedId = null,
}: {
  files: SelectableFile[];
  /** Signed server-side when the detail page opens — plan section 59. */
  initialViewUrl?: ViewUrl | null;
  /** `?file=<id>` deep link, validated by the page. */
  initialSelectedId?: string | null;
}) {
  const firstId = initialSelectedId ?? files[0]?.id ?? null;

  const [selectedId, setSelectedId] = useState<string | null>(firstId);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);

  /**
   * The URL, together with which file and which attempt it was minted for.
   * Bundling them means "is this URL still current?" is a comparison rather than
   * a chain of effects, and switching files needs no state reset.
   */
  const [loaded, setLoaded] = useState<{
    fileId: string;
    attempt: number;
    url: ViewUrl;
  } | null>(
    initialViewUrl && firstId
      ? { fileId: firstId, attempt: 0, url: initialViewUrl }
      : null,
  );

  const retries = useRef(0);

  const current =
    loaded && loaded.fileId === selectedId && loaded.attempt === attempt
      ? loaded.url
      : null;
  const selected = files.find((file) => file.id === selectedId) ?? null;
  const loading = selectedId !== null && current === null && error === null;

  useEffect(() => {
    if (!selectedId) return;
    // Already have a URL for this file at this attempt (e.g. the server-side one).
    if (loaded?.fileId === selectedId && loaded.attempt === attempt) return;

    const controller = new AbortController();

    requestViewUrl(selectedId, controller.signal)
      .then((url) => {
        setLoaded({ fileId: selectedId, attempt, url });
        setError(null);
      })
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(
          cause instanceof Error ? cause.message : "Không tải được tài liệu",
        );
      });

    return () => controller.abort();
  }, [selectedId, attempt, loaded]);

  // Proactive refresh a minute before the signature dies.
  useEffect(() => {
    if (!current) return;
    const timer = setTimeout(
      () => setAttempt((value) => value + 1),
      msUntilRefresh(current.expiresAt),
    );
    return () => clearTimeout(timer);
  }, [current]);

  const handleSignatureExpired = useCallback(() => {
    if (retries.current >= MAX_AUTO_RETRIES) return;
    retries.current += 1;
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  const selectFile = (fileId: string) => {
    if (fileId === selectedId) return;
    retries.current = 0;
    setError(null);
    setSelectedId(fileId);
  };

  if (files.length === 0) {
    return (
      <EmptyState
        icon={<FileQuestion className="h-6 w-6" />}
        title="Chưa có tài liệu đính kèm"
        description="Hợp đồng này chưa có tệp nào được tải lên. Wave 1 chỉ tải tệp lên khi tạo hợp đồng mới."
        className="h-full"
      />
    );
  }

  return (
    <div className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-md border lg:flex-row">
      <DocumentSelector
        files={files}
        selectedId={selectedId}
        onSelect={selectFile}
        disabled={loading}
      />

      <div className="min-h-0 min-w-0 flex-1">
        {error ? (
          <div className="p-4">
            <Alert variant="destructive">
              <AlertTitle>Không xem được tài liệu</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleSignatureExpired}
                >
                  Thử lại
                </Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : loading || !current || !selected ? (
          <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang tải tài liệu...
          </div>
        ) : isPdfMime(selected.mime_type) ? (
          <ViewerErrorBoundary onRetry={handleSignatureExpired}>
            <PdfPanel
              url={current.viewUrl}
              onSignatureExpired={handleSignatureExpired}
            />
          </ViewerErrorBoundary>
        ) : isImageMime(selected.mime_type) ? (
          <ImageViewer url={current.viewUrl} alt={selected.original_filename} />
        ) : (
          <div className="flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">
            Định dạng {selected.mime_type} chưa được hỗ trợ xem trước.
          </div>
        )}
      </div>
    </div>
  );
}
