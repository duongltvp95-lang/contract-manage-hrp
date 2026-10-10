"use client";

import { Check } from "lucide-react";
import { useEffect, useRef } from "react";

import { partnerCompaniesAction } from "@/app/(app)/partners/actions";
import { CompanyBadges } from "@/components/partners/partner-badges";
import { cn } from "@/lib/utils";

import type { PartnerOption } from "./partner-combobox";

/**
 * Round 32 — one row in the popover. Owns its own company fetch, triggered
 * by `IntersectionObserver` the first time the row scrolls into the
 * combobox's scroll container.
 *
 * Why per-row fetch (round 32-fix-2): the page is small today, but the
 * directory is expected to grow. Fetching for every option up front would
 * flood the server action as soon as the popover opens. Firing the request
 * only when the row actually shows up keeps the workload tied to what the
 * user can see — typing into search still narrows the list to a handful of
 * matches, and the user only ever pays for the rows they read.
 *
 * The shared `companiesByPartner` map (held by the parent) is the single
 * source of truth: this component reads from it and writes to it, so a row
 * that the user has not scrolled to yet can still find its data through the
 * parent.
 */
export function PartnerOptionRow({
  option,
  isSelected,
  onSelect,
  companies,
  onCompaniesLoaded,
}: {
  option: PartnerOption;
  isSelected: boolean;
  onSelect: () => void;
  /** Resolved names from the parent map; `undefined` = not yet loaded. */
  companies: string[] | undefined;
  /** Called once the lazy fetch settles, so the parent updates the map. */
  onCompaniesLoaded: (id: string, names: string[]) => void;
}) {
  const rowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Preloaded data wins — no need to touch the network.
    if (Array.isArray(option.companies) && option.companies.length > 0) return;
    if (companies !== undefined) return;

    const node = rowRef.current;
    if (!node) return;

    // Fallback for environments without IntersectionObserver (jsdom): fetch
    // immediately. The real browser path waits for visibility.
    if (typeof IntersectionObserver === "undefined") {
      void partnerCompaniesAction(option.id)
        .then((result) => {
          const names = result.ok && result.data ? result.data : [];
          onCompaniesLoaded(option.id, names);
        })
        .catch(() => {
          onCompaniesLoaded(option.id, []);
        });
      return;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.disconnect();
          void partnerCompaniesAction(option.id)
            .then((result) => {
              const names = result.ok && result.data ? result.data : [];
              onCompaniesLoaded(option.id, names);
            })
            .catch(() => {
              onCompaniesLoaded(option.id, []);
            });
          break;
        }
      },
      { root: node.closest("[data-testid='partner-combobox-list']") ?? null, rootMargin: "0px 0px 64px 0px" },
    );

    observer.observe(node);

    return () => {
      observer.disconnect();
    };
  }, [option.id, option.companies, companies, onCompaniesLoaded]);

  return (
    <button
      ref={rowRef}
      type="button"
      data-testid="partner-option"
      data-partner-id={option.id}
      onClick={onSelect}
      className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent"
    >
      <Check
        className={cn(
          "h-4 w-4 shrink-0",
          isSelected ? "opacity-100" : "opacity-0",
        )}
      />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="block truncate">{option.name}</span>
        {option.tax_code ? (
          <span className="block truncate text-xs text-muted-foreground">
            MST {option.tax_code}
          </span>
        ) : null}
        {companies && companies.length > 0 ? (
          <CompanyBadges companies={companies} />
        ) : null}
      </span>
    </button>
  );
}
