"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useRef } from "react";
import { Document, Page, pdfjs } from "react-pdf";

import "react-pdf/dist/Page/AnnotationLayer.css";
import "react-pdf/dist/Page/TextLayer.css";

/**
 * The react-pdf canvas — the ONLY module that imports PDF.js.
 *
 * `pdfjs-dist` touches `document` / `window` while its modules are evaluated, so
 * importing it during server rendering throws `ReferenceError: document is not
 * defined`. This module is therefore loaded with `next/dynamic({ ssr: false })`
 * from `pdf-panel.tsx`, which keeps the toolbar server-rendered and PDF.js
 * strictly client-side.
 *
 * The worker is resolved through the bundler (`new URL(…, import.meta.url)`), so
 * Turbopack emits it as a static asset — no CDN, no vendored copy in `public/`.
 */
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url,
).toString();

export function PdfCanvas({
  url,
  page,
  scale,
  rotation,
  onDocumentLoaded,
  onPageLoaded,
  onLoadError,
}: {
  url: string;
  page: number;
  scale: number;
  rotation: number;
  onDocumentLoaded: (numPages: number) => void;
  onPageLoaded: (pageWidth: number) => void;
  onLoadError: (message: string) => void;
}) {
  // PDF.js reports some failures (a CORS-blocked fetch, for one) as an unhandled
  // promise rejection rather than through `onLoadError`, which would otherwise
  // escape to Next's global error page and blank the whole contract view.
  const reportRef = useRef(onLoadError);

  useEffect(() => {
    reportRef.current = onLoadError;
  }, [onLoadError]);

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason as { name?: string; message?: string } | undefined;
      const signature = `${reason?.name ?? ""} ${reason?.message ?? String(reason ?? "")}`;
      if (/UnknownError|UnexpectedResponse|MissingPDF|InvalidPDF|CORS/i.test(signature)) {
        event.preventDefault();
        reportRef.current(reason?.message || "Không tải được tệp PDF");
      }
    };

    window.addEventListener("unhandledrejection", onRejection);
    return () => window.removeEventListener("unhandledrejection", onRejection);
  }, []);

  return (
    <Document
      file={url}
      onLoadSuccess={({ numPages }) => onDocumentLoaded(numPages)}
      onLoadError={(cause) => onLoadError(cause?.message || "Không tải được tệp PDF")}
      loading={
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Đang tải PDF...
        </div>
      }
      error={null}
      className="flex justify-center"
    >
      <Page
        pageNumber={page}
        scale={scale}
        rotate={rotation}
        onLoadSuccess={(loaded) =>
          onPageLoaded(loaded.originalWidth ?? loaded.width ?? 0)
        }
        loading={
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Đang hiển thị trang...
          </div>
        }
        className="shadow-sm"
      />
    </Document>
  );
}
