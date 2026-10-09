"use client";

import { useRouter } from "next/navigation";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Round 28 — "Số hợp đồng" filter next to the partners status tabs.
 *
 * Writes straight into the URL (`?contracts=has|none`) like every other list
 * filter; the current `?status=` is preserved when the value changes. "Tất cả"
 * drops the param entirely.
 */
export function PartnersContractsFilter({
  contracts,
  status,
}: {
  contracts: "has" | "none" | undefined;
  status: "active" | "stopped" | undefined;
}) {
  const router = useRouter();

  const go = (value: string) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (value !== "all") params.set("contracts", value);
    const query = params.toString();
    router.push(query ? `/partners?${query}` : "/partners");
  };

  return (
    <Select value={contracts ?? "all"} onValueChange={go}>
      <SelectTrigger
        className="w-48"
        aria-label="Lọc theo số hợp đồng"
        data-testid="partner-contracts-filter"
      >
        <SelectValue placeholder="Số hợp đồng" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="all" data-testid="partner-contracts-all">
          Tất cả
        </SelectItem>
        <SelectItem value="has" data-testid="partner-contracts-has">
          Có hợp đồng
        </SelectItem>
        <SelectItem value="none" data-testid="partner-contracts-none">
          Chưa có hợp đồng
        </SelectItem>
      </SelectContent>
    </Select>
  );
}
