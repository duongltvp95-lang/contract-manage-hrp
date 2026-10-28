"use client";

import { Download, Loader2, Maximize2, RotateCcw, RotateCw, ZoomIn, ZoomOut } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { downloadFileFromUrl } from "@/lib/view-url";
import { cn } from "@/lib/utils";

/**
 * Image viewer — plan section 58.
 *
 * Browser image rendering plus CSS transforms for zoom / rotate / fit. No image
 * library, and deliberately a plain `<img>` rather than `next/image`: the object
 * lives in a private R2 bucket behind a short-lived signed URL, so the Next
 * image optimizer has nothing it can cache or resize.
 */

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 5;
const ZOOM_STEP = 0.25;

export function ImageViewer({ url, alt }: { url: string; alt: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [fit, setFit] = useState(true);
  const [failed, setFailed] = useState(false);
  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      await downloadFileFromUrl(url, alt || "hinh-anh.png");
    } finally {
      setDownloading(false);
    }
  };

  const changeZoom = (delta: number) => {
    setFit(false);
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
      <div className="flex flex-wrap items-center gap-1 border-b px-2 py-1.5">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Thu nhỏ"
              data-testid="image-zoom-out"
              disabled={!fit && zoom <= MIN_ZOOM}
              onClick={() => changeZoom(-ZOOM_STEP)}
            >
              <ZoomOut className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Thu nhỏ</TooltipContent>
        </Tooltip>

        <span className="px-1 text-sm tabular-nums" data-testid="image-zoom-indicator">
          {Math.round((fit ? 1 : zoom) * 100)}%
        </span>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Phóng to"
              data-testid="image-zoom-in"
              disabled={!fit && zoom >= MAX_ZOOM}
              onClick={() => changeZoom(ZOOM_STEP)}
            >
              <ZoomIn className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Phóng to</TooltipContent>
        </Tooltip>

        <Button
          type="button"
          variant={fit ? "secondary" : "ghost"}
          size="sm"
          aria-pressed={fit}
          onClick={() => {
            setFit(true);
            setZoom(1);
          }}
        >
          Vừa khung
        </Button>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Xoay phải"
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
              onClick={toggleFullscreen}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toàn màn hình</TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="mx-1 h-5" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="ml-auto gap-1.5 h-8 text-xs font-medium border-emerald-600/30 bg-emerald-50/50 hover:bg-emerald-100/70 text-emerald-700 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:hover:bg-emerald-900/50 dark:text-emerald-400 shadow-2xs"
              data-testid="image-download"
              onClick={handleDownload}
              disabled={downloading}
            >
              {downloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span>Tải ảnh về</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Tải tệp ảnh này về máy tính</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-muted/40 p-4">
        {failed ? (
          <p className="text-sm text-destructive">Không tải được ảnh.</p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- private R2 object behind a signed URL
          <img
            src={url}
            alt={alt}
            data-testid="image-viewer-image"
            onError={() => setFailed(true)}
            onLoad={() => setFailed(false)}
            className={cn(
              "origin-center transition-transform duration-150",
              fit && "max-h-full max-w-full object-contain",
            )}
            style={{
              transform: `rotate(${rotation}deg) scale(${fit ? 1 : zoom})`,
            }}
          />
        )}
      </div>
    </div>
  );
}
