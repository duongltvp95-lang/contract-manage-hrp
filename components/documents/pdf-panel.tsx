"use client";

import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  Maximize2,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * PDF viewer — plan sections 56, 57.
 *
 * Two layers on purpose:
 *   - this panel owns the toolbar, page number, scale, rotation and container
 *     width, and is server-rendered like any other component;
 *   - `PdfCanvas` (loaded with `ssr: false`) is the only place PDF.js is
 *     imported, because `pdfjs-dist` reads `document` at module scope.
 *
 * No PDF.js internals are touched — the canvas is a `<Document>` / `<Page>`
 * wrapper whose inputs are our state.
 *
 * Page and zoom survive a signed-URL refresh: the URL arrives as a prop, and
 * per-URL values are keyed by that URL, so a new URL never inherits a stale
 * error or a stale page width.
 */
const PdfCanvas = dynamic(
  () => import("@/components/documents/pdf-canvas").then((mod) => mod.PdfCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Đang tải trình xem PDF...
      </div>
    ),
  },
);

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.2;

type UrlScoped<T> = { url: string; value: T };

export function PdfPanel({
  url,
  onSignatureExpired,
}: {
  url: string;
  onSignatureExpired: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [fitWidth, setFitWidth] = useState(true);
  const [rotation, setRotation] = useState(0);

  const [loadError, setLoadError] = useState<UrlScoped<string> | null>(null);
  const [pageWidth, setPageWidth] = useState<UrlScoped<number> | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const error = loadError?.url === url ? loadError.value : null;
  const naturalWidth = pageWidth?.url === url ? pageWidth.value : 0;

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (typeof width === "number") setContainerWidth(width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const scale =
    fitWidth && naturalWidth > 0 && containerWidth > 0
      ? Math.max(MIN_ZOOM, (containerWidth - 32) / naturalWidth)
      : zoom;

  const goToPage = useCallback(
    (next: number) => setPage(Math.min(Math.max(1, next), Math.max(1, numPages))),
    [numPages],
  );

  const changeZoom = (delta: number) => {
    setFitWidth(false);
    setZoom((current) =>
      Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number((current + delta).toFixed(2)))),
    );
  };

  const toggleFullscreen = () => {
    const element = containerRef.current;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen();
  };

  return (
    <div ref={containerRef} className="flex h-full flex-col">
      <div
        className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5"
        data-testid="pdf-toolbar"
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Trang trước"
              data-testid="pdf-prev"
              disabled={page <= 1}
              onClick={() => goToPage(page - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Trang trước</TooltipContent>
        </Tooltip>

        <span className="px-1 text-sm tabular-nums" data-testid="pdf-page-indicator">
          {numPages > 0 ? `${page}/${numPages}` : "–"}
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Trang sau"
              data-testid="pdf-next"
              disabled={numPages === 0 || page >= numPages}
              onClick={() => goToPage(page + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Trang sau</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Thu nhỏ"
              data-testid="pdf-zoom-out"
              disabled={!fitWidth && zoom <= MIN_ZOOM}
              onClick={() => changeZoom(-ZOOM_STEP)}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Thu nhỏ</TooltipContent>
        </Tooltip>

        <span className="px-1 text-sm tabular-nums" data-testid="pdf-zoom-indicator">
          {Math.round(scale * 100)}%
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Phóng to"
              data-testid="pdf-zoom-in"
              disabled={!fitWidth && zoom >= MAX_ZOOM}
              onClick={() => changeZoom(ZOOM_STEP)}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Phóng to</TooltipContent>
        </Tooltip>

        <Button
          type="button"
          variant={fitWidth ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={fitWidth}
          data-testid="pdf-fit-width"
          onClick={() => setFitWidth(true)}
        >
          Vừa chiều rộng
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Xoay phải"
              data-testid="pdf-rotate-right"
              onClick={() => setRotation((current) => (current + 90) % 360)}
            >
              <RotateCw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Xoay phải</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Xoay trái"
              data-testid="pdf-rotate-left"
              onClick={() => setRotation((current) => (current + 270) % 360)}
            >
              <RotateCcw className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Xoay trái</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Toàn màn hình"
              data-testid="pdf-fullscreen"
              onClick={toggleFullscreen}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toàn màn hình</TooltipContent>
        </Tooltip>
      </div>

      <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-4">
        {error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSignatureExpired}
            >
              Tải lại
            </Button>
          </div>
        ) : (
          <PdfCanvas
            url={url}
            page={page}
            scale={scale}
            rotation={rotation}
            onDocumentLoaded={(total) => {
              setNumPages(total);
              setPage((current) => Math.min(current, total));
            }}
            onPageLoaded={(width) => setPageWidth({ url, value: width })}
            onLoadError={(message) => {
              // An expired signature surfaces here as a failed fetch. Ask for a
              // fresh URL; the parent rate-limits the retries.
              setLoadError({ url, value: message });
              onSignatureExpired();
            }}
          />
        )}
      </div>
    </div>
  );
}
