"use client";

import { ChevronsUpDown, Loader2, Plus, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { searchPartnersAction } from "@/app/(app)/partners/actions";
import { PartnerNameSheet } from "@/components/partners/partner-name-sheet";
import { PartnerOptionRow } from "@/components/partners/partner-option-row";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  filterPartners,
  PARTNER_SEARCH_LIMIT,
} from "@/lib/partner-display";
import type { PartnerRow } from "@/lib/services/partners";
import { cn } from "@/lib/utils";

/**
 * Searchable partner picker — feature round 2, part 2; quick search round 6;
 * company badges round 32 (REMOVED in round 33).
 *
 * Round 2 built the picker from the shadcn primitives the project already
 * uses (`Popover`, `Button`, lucide icons) and filtered the whole directory in
 * memory. Round 6 keeps that but stops shipping the whole directory: the page
 * passes only the first alphabetical page, and typing searches the database
 * through a server action (debounced), so the picker stays fast no matter how
 * many partners the organization has.
 *
 * The local `filterPartners` still runs on every keystroke, so the first page
 * answers instantly while the server query is in flight.
 *
 * Round 32 added the linked-company badge and paid for it: every rendered row
 * asked the server which companies it belonged to (`partnerCompaniesAction`),
 * and the trigger ALSO asked for the selected partner — so the badge on the
 * closed combobox only appeared after a round trip, which the user saw as the
 * control "lagging" after they picked a partner. Round 33 removes all of it:
 * the company is now an explicit `<Select>` field directly below this one in
 * the contract form, where the user chooses it rather than being told. Nothing
 * in the picker touches the network except the debounced search.
 *
 * Creating a partner happens inline ("+ Thêm đối tác"), and the new row is
 * selected immediately. There is no "clear" affordance: a new contract must
 * name a partner, and silently unlinking an existing one would be a data
 * change nobody asked for.
 */

export type PartnerOption = {
  id: string;
  name: string;
  tax_code?: string | null;
};

export function PartnerCombobox({
  value,
  onChange,
  partners,
  selectedPartner = null,
  onPartnerCreated,
  disabled,
  placeholder = "Chọn đối tác",
  id,
  invalid,
}: {
  value: string;
  onChange: (partnerId: string) => void;
  /** First alphabetical page of the directory, read on the server. */
  partners: PartnerOption[];
  /** The partner already linked when editing, even if outside `partners`. */
  selectedPartner?: { id: string; name: string; tax_code?: string | null } | null;
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
  const [results, setResults] = useState<PartnerOption[] | null>(null);
  const [searching, setSearching] = useState(false);
  // The option the user picked from the SEARCH results. The form only knows the
  // partners it received as props, so without this cache the button would go
  // back to its placeholder once the popover closes (round 6).
  const [picked, setPicked] = useState<PartnerOption | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const requestSeq = useRef(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cancel any in-flight debounced search when the combobox unmounts.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const selected =
    partners.find((partner) => partner.id === value) ??
    picked ??
    selectedPartner ??
    null;

  const needle = term.trim();
  // Memoised so the options list below (and the effect that reads it) does
  // not see a new array reference on every render. The dependency is the
  // needle, the in-memory page and the server result, exactly the inputs that
  // decide which options are visible.
  const visible = useMemo(() => {
    if (!needle) return partners;
    if (results === null) return filterPartners(partners, needle);
    return results ?? [];
  }, [needle, results, partners]);

  // The linked partner stays visible and selectable even when it is outside
  // the loaded slice (editing a contract whose partner sorts past page one).
  // Memoised so the effect below does not re-run on every render — the
  // eslint rule cares about reference stability, and recreating the array
  // would loop the effect forever.
  const options = useMemo(
    () =>
      selected && !visible.some((partner) => partner.id === selected.id)
        ? [selected, ...visible]
        : visible,
    [selected, visible],
  );

  const capped = Boolean(needle) && (results?.length ?? 0) >= PARTNER_SEARCH_LIMIT;

  // Debounced server search, driven from the keystroke handler. The local
  // filter answers instantly from the in-memory page; the server call is the
  // authoritative answer over the whole directory. A stale response (older
  // keystroke) is dropped by the sequence guard.
  function handleTermChange(next: string) {
    setTerm(next);
    const needle = next.trim();

    if (!needle) {
      requestSeq.current += 1;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      setSearching(false);
      setResults(null);
      return;
    }

    const seq = ++requestSeq.current;
    setSearching(true);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      const outcome = await searchPartnersAction(needle);
      if (seq !== requestSeq.current) return;
      setSearching(false);
      setResults(outcome.ok ? (outcome.data ?? []) : []);
    }, 250);
  }

  return (
    <>
      <Popover
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setTerm("");
            setResults(null);
          }
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
            <span className="flex min-w-0 flex-1 items-center gap-2">
              <span className="truncate">{selected ? selected.name : placeholder}</span>
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        <PopoverContent
          align="start"
          className="w-[--radix-popover-trigger-width] p-0"
          onOpenAutoFocus={(event) => {
            // Jump straight into typing — quick search is the point.
            event.preventDefault();
            searchInputRef.current?.focus();
          }}
        >
          <div className="flex items-center border-b px-3">
            <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
            <input
              ref={searchInputRef}
              value={term}
              onChange={(event) => handleTermChange(event.target.value)}
              placeholder="Tìm nhanh theo tên hoặc mã số thuế..."
              aria-label="Tìm đối tác"
              data-testid="partner-combobox-search"
              className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
            {searching ? (
              <Loader2
                className="ml-2 h-4 w-4 shrink-0 animate-spin opacity-50"
                aria-label="Đang tìm"
                data-testid="partner-combobox-searching"
              />
            ) : null}
          </div>

          <div className="max-h-64 overflow-y-auto p-1" data-testid="partner-combobox-list">
            {options.length === 0 ? (
              <p className="p-2 text-sm text-muted-foreground">
                Không tìm thấy đối tác
              </p>
            ) : (
              options.map((partner) => (
                <PartnerOptionRow
                  key={partner.id}
                  option={partner}
                  isSelected={partner.id === value}
                  onSelect={() => {
                    onChange(partner.id);
                    setPicked(partner);
                    setOpen(false);
                    setTerm("");
                    setResults(null);
                  }}
                />
              ))
            )}
            {capped ? (
              <p
                className="px-2 pb-1 pt-0.5 text-xs text-muted-foreground"
                data-testid="partner-combobox-capped"
              >
                Còn nhiều kết quả — hãy gõ thêm để lọc chính xác hơn.
              </p>
            ) : null}
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
