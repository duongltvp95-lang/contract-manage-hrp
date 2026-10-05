"use client";

import { Check, ChevronsUpDown, Plus, Search } from "lucide-react";
import { useState } from "react";

import { PartnerNameSheet } from "@/components/partners/partner-name-sheet";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { filterPartners } from "@/lib/partner-display";
import type { PartnerRow } from "@/lib/services/partners";
import { cn } from "@/lib/utils";

/**
 * Searchable partner picker — feature round 2, part 2.
 *
 * Built from the shadcn primitives the project already uses (`Popover`, `Button`,
 * `Input` styling, lucide icons) rather than adding shadcn's `Command`, which
 * would mean a new dependency (`cmdk`) for a list that is already in memory:
 * `listPartners()` returns the whole directory because the filter controls need
 * it, so filtering here is instant and needs no round trip.
 *
 * Creating a partner happens inline ("+ Thêm đối tác"), and the new row is
 * selected immediately — the reason to create one while filling in a contract is
 * almost always "because I need it for this contract".
 *
 * There is no "clear" affordance: a new contract must name a partner, and
 * silently unlinking an existing one would be a data change nobody asked for.
 */

export type PartnerOption = Pick<PartnerRow, "id" | "name">;

export function PartnerCombobox({
  value,
  onChange,
  partners,
  onPartnerCreated,
  disabled,
  placeholder = "Chọn đối tác",
  id,
  invalid,
}: {
  value: string;
  onChange: (partnerId: string) => void;
  partners: PartnerOption[];
  /** Called with a partner created from inside the combobox. */
  onPartnerCreated: (partner: PartnerRow) => void;
  disabled?: boolean;
  placeholder?: string;
  id?: string;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  const selected = partners.find((partner) => partner.id === value) ?? null;
  const filtered = filterPartners(partners, term);

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setTerm("");
        }}
      >
        <PopoverTrigger asChild>
          <Button
            id={id}
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-invalid={invalid ? true : undefined}
            disabled={disabled}
            data-testid="partner-combobox"
            className={cn(
              "w-full justify-between font-normal",
              !selected && "text-muted-foreground",
            )}
          >
            <span className="truncate">{selected ? selected.name : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] p-0"
        >
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              value={term}
              onChange={(event) => setTerm(event.target.value)}
              placeholder="Tìm đối tác..."
              aria-label="Tìm đối tác"
              data-testid="partner-combobox-search"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <div className="max-h-64 overflow-y-auto p-1" data-testid="partner-combobox-list">
            {filtered.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">
                Không tìm thấy đối tác
              </p>
            ) : (
              filtered.map((partner) => (
                <button
                  key={partner.id}
                  type="button"
                  data-testid="partner-option"
                  data-partner-id={partner.id}
                  onClick={() => {
                    onChange(partner.id);
                    setOpen(false);
                    setTerm("");
                  }}
                  className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      partner.id === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{partner.name}</span>
                </button>
              ))
            )}
          </div>

          <div className="border-t p-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start"
              data-testid="partner-combobox-add"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
            >
              <Plus className="mr-2 h-4 w-4" />
              Thêm đối tác
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Opened from inside the popover, so it is driven programmatically. */}
      <PartnerNameSheet
        mode="create"
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSaved={(partner) => {
          onPartnerCreated(partner);
          onChange(partner.id);
        }}
      />
    </>
  );
}
