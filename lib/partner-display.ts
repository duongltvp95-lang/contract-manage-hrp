/**
 * Partner display rules — feature round 2, part 2.
 *
 * Pure and framework-free on purpose: server components, client components and
 * the unit suite all use the same rules, so "which name do we show?" cannot end
 * up answered two different ways in two places.
 */

export type PartnerNamed = {
  partner_name?: string | null;
  partner_text?: string | null;
};

/** The dash shown when a contract has no partner information at all. */
export const NO_PARTNER = "—";

/**
 * The linked partner's name wins; the free-text column is the fallback.
 *
 * Order matters: a contract may have both (linked after being entered as text),
 * and the directory entry is the authoritative spelling.
 */
export function partnerDisplayName(input: PartnerNamed): string {
  const linked = input.partner_name?.trim();
  if (linked) return linked;

  const freeText = input.partner_text?.trim();
  if (freeText) return freeText;

  return NO_PARTNER;
}

/**
 * True for a contract that predates the partners table: free text, no link.
 *
 * The edit form shows that text read-only and does not force a partner onto it —
 * re-saving an old contract must not rewrite its history.
 */
export function isLegacyPartnerText(input: PartnerNamed): boolean {
  return !input.partner_name?.trim() && Boolean(input.partner_text?.trim());
}

/**
 * Folds a string for searching: lowercase, no diacritics, `đ` treated as `d`.
 *
 * Vietnamese users type "doi tac" at least as often as "đối tác"; without the
 * folding, the combobox would silently find nothing for the unaccented spelling.
 */
function fold(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim();
}

/**
 * The combobox's client-side filter.
 *
 * The whole directory is already in memory (`listPartners` returns all of it for
 * the filter controls), so filtering here is instant and needs no round trip.
 * An empty term returns everything, unfiltered.
 */
export function filterPartners<T extends { name: string }>(
  partners: T[],
  term: string,
): T[] {
  const needle = fold(term);
  if (!needle) return partners;

  return partners.filter((partner) => fold(partner.name).includes(needle));
}
