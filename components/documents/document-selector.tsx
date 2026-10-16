"use client";

import { FileText, ImageIcon, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes } from "@/lib/format";
import { isImageMime } from "@/lib/view-url";
import { cn } from "@/lib/utils";

/**
 * Document selector — plan section 55; round 16.
 *
 * Shows every file attached to the contract, grouped into "Tài liệu" and "Phụ
 * lục hợp đồng" (the latter only when an appendix exists). Clicking one switches
 * the viewer immediately, and the active file is highlighted.
 */

export type SelectableFile = {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size: number | null;
  kind?: "document" | "appendix";
};

export function DocumentSelector({
  files,
  selectedId,
  onSelect,
  disabled,
  onAddFile,
  onDeleteFile,
}: {
  files: SelectableFile[];
  selectedId: string | null;
  onSelect: (fileId: string) => void;
  disabled?: boolean;
  onAddFile?: () => void;
  onDeleteFile?: (file: SelectableFile) => void;
}) {
  if (files.length === 0) {
    return null;
  }

  const documents = files.filter((file) => file.kind !== "appendix");
  const appendices = files.filter((file) => file.kind === "appendix");

  return (
    <ScrollArea className="w-full lg:w-56 lg:shrink-0 lg:border-r">
      <div className="p-2 space-y-2" data-testid="document-selector">
        {onAddFile && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full justify-center gap-1.5 text-xs font-medium"
            onClick={onAddFile}
            disabled={disabled}
          >
            <Plus className="h-3.5 w-3.5" />
            Thêm tài liệu
          </Button>
        )}
        <FileGroup
          label="Tài liệu"
          files={documents}
          selectedId={selectedId}
          onSelect={onSelect}
          disabled={disabled}
          onDeleteFile={onDeleteFile}
        />
        <FileGroup
          label="Phụ lục hợp đồng"
          files={appendices}
          selectedId={selectedId}
          onSelect={onSelect}
          disabled={disabled}
          onDeleteFile={onDeleteFile}
        />
      </div>
    </ScrollArea>
  );
}

function FileGroup({
  label,
  files,
  selectedId,
  onSelect,
  disabled,
  onDeleteFile,
}: {
  label: string;
  files: SelectableFile[];
  selectedId: string | null;
  onSelect: (fileId: string) => void;
  disabled?: boolean;
  onDeleteFile?: (file: SelectableFile) => void;
}) {
  if (files.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1" data-testid={`file-group-${label === "Tài liệu" ? "document" : "appendix"}`}>
      <p className="px-2 pt-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <ul className="flex flex-wrap gap-1 lg:flex-col">
        {files.map((file) => {
          const Icon = isImageMime(file.mime_type) ? ImageIcon : FileText;
          const active = file.id === selectedId;

          return (
            <li key={file.id} className="group relative flex items-center">
              <Button
                type="button"
                variant={active ? "secondary" : "ghost"}
                disabled={disabled}
                aria-current={active ? "true" : undefined}
                data-testid={`document-option-${file.id}`}
                onClick={() => onSelect(file.id)}
                className={cn(
                  "h-auto w-full justify-start gap-2 px-2 py-2 text-left",
                  onDeleteFile && "pr-8",
                  active && "ring-1 ring-ring",
                )}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm">{file.original_filename}</span>
                  <span className="block text-xs text-muted-foreground">
                    {file.file_size !== null ? formatBytes(file.file_size) : file.mime_type}
                  </span>
                </span>
              </Button>
              {onDeleteFile && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={disabled}
                  aria-label={`Xoá ${file.original_filename}`}
                  title="Xoá tệp này"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDeleteFile(file);
                  }}
                  className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
