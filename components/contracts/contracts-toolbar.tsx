"use client";

import { Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { DateField } from "@/components/contracts/date-field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  contractsHref,
  hasActiveFilters,
  PRESET_LABELS,
  PRESET_OPTIONS,
  type ContractsQuery,
  type ExpiryPreset,
} from "@/lib/contracts-query";
import { cn } from "@/lib/utils";

/**
 * Search + filter controls — plan sections 50, 51, 52.
 *
 * Every control writes straight into the URL, which is the single source of
 * truth for the list. There is no local query state to keep in sync, so a
 * filtered view is always shareable and back/forward works.
 */

const ALL = "all";

export function ContractsToolbar({
  query,
  scope = "active",
}: {
  query: ContractsQuery;
  scope?: "active" | "expired" | "archived";
}) {
  const router = useRouter();
  const go = (patch: Partial<ContractsQuery>) => {
    let href = contractsHref(patch, query);
    if (scope !== "active") {
      href = `${href}${href.includes("?") ? "&" : "?"}scope=${scope}`;
    }
    router.push(href);
  };

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const value = new FormData(event.currentTarget).get("q");
          go({ q: typeof value === "string" ? value : "", page: 1 });
        }}
      >
        <Input
          name="q"
          defaultValue={query.q}
          placeholder="Tìm theo số hợp đồng hoặc đối tác..."
          aria-label="Tìm hợp đồng"
          className="max-w-sm"
        />
        <Button type="submit">
          <Search className="mr-2 h-4 w-4" />
          Tìm
        </Button>
        {hasActiveFilters(query) && (
          <Button type="button" variant="ghost" asChild>
            <Link href={scope !== "active" ? `/contracts?scope=${scope}` : "/contracts"}>
              <X className="mr-2 h-4 w-4" />
              Xoá bộ lọc
            </Link>
          </Button>
        )}
      </form>

      <div
        className={cn(
          "grid gap-3 sm:grid-cols-2",
          scope === "active" ? "lg:grid-cols-5" : "lg:grid-cols-4",
        )}
      >
        {/* Round 20: the expiry preset is redundant on the expired/archived tabs
            (the scope already answers the question), so it is hidden there. */}
        {scope === "active" && (
          <div className="space-y-1.5">
            <Label htmlFor="preset">Trạng thái hạn</Label>
            <Select
              value={query.preset || ALL}
              onValueChange={(value) =>
                go({
                  preset: value === ALL ? "" : (value as ExpiryPreset),
                  page: 1,
                })
              }
            >
              <SelectTrigger id="preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Tất cả</SelectItem>
                {PRESET_OPTIONS.map((preset) => (
                  <SelectItem key={preset} value={preset}>
                    {PRESET_LABELS[preset]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <DateFilter
          id="signedFrom"
          label="Ngày ký từ"
          value={query.signedFrom}
          onChange={(value) => go({ signedFrom: value ?? "", page: 1 })}
        />
        <DateFilter
          id="signedTo"
          label="Ngày ký đến"
          value={query.signedTo}
          onChange={(value) => go({ signedTo: value ?? "", page: 1 })}
        />
        <DateFilter
          id="expiryFrom"
          label="Hết hạn từ"
          value={query.expiryFrom}
          onChange={(value) => go({ expiryFrom: value ?? "", page: 1 })}
        />
        <DateFilter
          id="expiryTo"
          label="Hết hạn đến"
          value={query.expiryTo}
          onChange={(value) => go({ expiryTo: value ?? "", page: 1 })}
        />
      </div>
    </div>
  );
}

function DateFilter({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string | undefined) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <DateField
        id={id}
        value={value || undefined}
        onChange={onChange}
        placeholder="Tất cả"
      />
    </div>
  );
}
