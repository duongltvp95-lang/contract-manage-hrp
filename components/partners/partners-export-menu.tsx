"use client";

import { FileSpreadsheet } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

/**
 * Partner export menu — round 23.
 *
 * Three plain `<a>` links to the export route (NOT Next `Link`: the router
 * would intercept the click, issue a 405 POST, and only then fall back to the
 * download). A real anchor downloads the workbook in one step.
 */
export function PartnersExportMenu() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" data-testid="partners-export-button">
          <FileSpreadsheet className="mr-2 h-4 w-4" />
          Xuất Excel
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild data-testid="partners-export-item-all">
          <a href="/api/partners/export">Xuất tất cả</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild data-testid="partners-export-item-active">
          <a href="/api/partners/export?status=active">Xuất đang hợp tác</a>
        </DropdownMenuItem>
        <DropdownMenuItem asChild data-testid="partners-export-item-stopped">
          <a href="/api/partners/export?status=stopped">Xuất đã dừng hợp tác</a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
