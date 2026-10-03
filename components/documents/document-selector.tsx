"use client";

import { FileText, ImageIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatBytes } from "@/lib/format";
import { isImageMime } from "@/lib/view-url";
import { cn } from "@/lib/utils";

/**
 * Document selector — plan section 55.
 *
 * Shows every file attached to the contract; clicking one switches the viewer
 * immediately, and the active file is highlighted.
 */

export type SelectableFile = {
  id: string;
  original_filename: string;
  mime_type: string;
  file_size: number | null;
};

export function DocumentSelector({
  files,
  selectedId,
  onSelect,
  disabled,
}: {
  files: SelectableFile[];
  selectedId: string | null;
  onSelect: (fileId: string) => void;
  disabled?: boolean;
}) {
  if (files.length === 0) {
    return null;
  }

  return (
    <ScrollArea className="w-full lg:w-56 lg:shrink-0 lg:border-r">
      <ul className="flex gap-1 p-2 lg:flex-col" data-testid="document-selector">
        {files.map((file) => {
          const Icon = isImageMime(file.mime_type) ? ImageIcon : FileText;
          const active = file.id === selectedId;

          return (
            <li key={file.id}>
              <Button
                type="button"
                variant={active ? "secondary" : "ghost"}
                disabled={disabled}
                aria-current={active ? "true" : undefined}
                data-testid={`document-option-${file.id}`}
                onClick={() => onSelect(file.id)}
                className={cn(
                  "h-auto w-full justify-start gap-2 px-2 py-2 text-left",
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
            </li>
          );
        })}
      </ul>
    </ScrollArea>
  );
}
