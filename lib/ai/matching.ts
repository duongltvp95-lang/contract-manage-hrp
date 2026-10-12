/**
 * Normalizes Vietnamese string by removing diacritics, extra spaces, and common legal entity prefixes.
 */
export function normalizeVietnameseText(str: string): string {
  return str
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const LEGAL_PREFIXES = [
  "cong ty co phan tap doan",
  "cong ty co phan",
  "cong ty tnhh mot thanh vien",
  "cong ty tnhh 1 tv",
  "cong ty tnhh mtv",
  "cong ty tnhh",
  "cty co phan",
  "cty tnhh mtv",
  "cty tnhh",
  "cty cp",
  "cty",
  "tong cong ty",
  "tap doan",
  "doanh nghiep tu nhan",
  "dntn",
  "chi nhanh",
  "van phong dai dien",
  "vpdd",
];

export function cleanEntityName(name: string): string {
  let cleaned = normalizeVietnameseText(name);
  for (const prefix of LEGAL_PREFIXES) {
    if (cleaned.startsWith(prefix + " ")) {
      cleaned = cleaned.slice(prefix.length + 1).trim();
      break;
    }
  }
  return cleaned;
}

export type EntityOption = {
  id: string;
  name: string;
};

/**
 * Finds the best matching partner given an extracted partner name from AI.
 */
export function findBestMatchingPartner(
  extractedName: string | undefined | null,
  partners: EntityOption[],
): EntityOption | null {
  if (!extractedName || !extractedName.trim()) return null;
  const rawTarget = normalizeVietnameseText(extractedName);
  const cleanTarget = cleanEntityName(extractedName);

  if (!cleanTarget) return null;

  // 1. Exact raw match
  for (const partner of partners) {
    if (normalizeVietnameseText(partner.name) === rawTarget) {
      return partner;
    }
  }

  // 2. Exact cleaned match (ignoring "Công ty TNHH", "Công ty CP", etc.)
  for (const partner of partners) {
    const cleanPartner = cleanEntityName(partner.name);
    if (cleanPartner && cleanPartner === cleanTarget) {
      return partner;
    }
  }

  // 3. Substring match (either contains the other)
  let bestMatch: EntityOption | null = null;
  let bestScore = 0;

  for (const partner of partners) {
    const cleanPartner = cleanEntityName(partner.name);
    if (!cleanPartner) continue;

    if (cleanTarget.includes(cleanPartner) || cleanPartner.includes(cleanTarget)) {
      // Score by length of match
      const score = Math.min(cleanTarget.length, cleanPartner.length) / Math.max(cleanTarget.length, cleanPartner.length);
      if (score > bestScore && score >= 0.5) {
        bestScore = score;
        bestMatch = partner;
      }
    }
  }

  return bestMatch;
}

/**
 * Finds the best matching company (internal legal entity) given an extracted company name.
 */
export function findBestMatchingCompany(
  extractedName: string | undefined | null,
  companies: EntityOption[],
): EntityOption | null {
  if (!extractedName || !extractedName.trim()) return null;
  const rawTarget = normalizeVietnameseText(extractedName);
  const cleanTarget = cleanEntityName(extractedName);

  for (const company of companies) {
    const rawCompany = normalizeVietnameseText(company.name);
    const cleanCompany = cleanEntityName(company.name);

    if (rawCompany === rawTarget || cleanCompany === cleanTarget) {
      return company;
    }

    if (
      (cleanTarget && cleanCompany && cleanTarget.includes(cleanCompany)) ||
      (cleanCompany && cleanTarget && cleanCompany.includes(cleanTarget))
    ) {
      return company;
    }
  }

  return null;
}
