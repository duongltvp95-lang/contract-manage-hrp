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
 * Checks if a company name belongs to one of our internal companies:
 * - CÔNG TY TNHH HR PARTNER VIỆT NAM (HR VN)
 * - CÔNG TY TNHH HR PARTNER (HRP)
 */
export function isInternalCompany(name: string | undefined | null): boolean {
  if (!name || !name.trim()) return false;
  const normalized = normalizeVietnameseText(name);

  // Exact abbreviations
  if (normalized === "hrp" || normalized === "hr vn") return true;

  // Contains HR Partner / HRPartner
  if (normalized.includes("hr partner") || normalized.includes("hrpartner")) return true;

  // Contains HR VN / HR Viet Nam
  if (normalized.includes("hr vn") || normalized.includes("hr viet nam")) return true;

  return false;
}

/**
 * Resolves which of our 2 internal companies ("HR VN" or "HRP") a given name refers to.
 */
export function resolveInternalCompanyKey(name: string | undefined | null): "HR VN" | "HRP" | null {
  if (!name || !name.trim()) return null;
  const normalized = normalizeVietnameseText(name);

  if (
    normalized.includes("viet nam") ||
    normalized.includes("hr vn") ||
    normalized === "hr vn"
  ) {
    if (
      normalized.includes("hr partner") ||
      normalized.includes("hrpartner") ||
      normalized.includes("hr vn") ||
      normalized.includes("hr viet nam")
    ) {
      return "HR VN";
    }
  }

  if (
    normalized === "hrp" ||
    normalized.includes("hr partner") ||
    normalized.includes("hrpartner")
  ) {
    return "HRP";
  }

  return null;
}

/**
 * Reconciles parties extracted from contract:
 * Ensures that if an internal company was assigned to partnerName,
 * it gets swapped with companyName or moved to companyName,
 * so our internal company NEVER becomes partnerName.
 */
export function reconcileContractParties(input: {
  partnerName: string;
  companyName: string;
}): { partnerName: string; companyName: string } {
  let partner = input.partnerName.trim();
  let company = input.companyName.trim();

  const partnerIsInternal = isInternalCompany(partner);
  const companyIsInternal = isInternalCompany(company);

  if (partnerIsInternal && !companyIsInternal) {
    // Partner is our internal company, and Company is the external party -> Swap them!
    const temp = partner;
    partner = company;
    company = temp;
  } else if (partnerIsInternal && companyIsInternal) {
    // Both point to internal companies -> Keep the internal one in company, clear partner
    company = partner;
    partner = "";
  }

  return { partnerName: partner, companyName: company };
}

/**
 * Finds the best matching company (internal legal entity) given an extracted company name.
 */
export function findBestMatchingCompany(
  extractedName: string | undefined | null,
  companies: EntityOption[],
): EntityOption | null {
  if (!extractedName || !extractedName.trim()) return null;

  // 1. Check known aliases for HR VN and HRP
  const resolvedKey = resolveInternalCompanyKey(extractedName);
  if (resolvedKey) {
    const matched = companies.find(
      (c) => normalizeVietnameseText(c.name) === normalizeVietnameseText(resolvedKey),
    );
    if (matched) return matched;

    if (resolvedKey === "HR VN") {
      return { id: "00000000-0000-4000-8000-000000000002", name: "HR VN" };
    }
    if (resolvedKey === "HRP") {
      return { id: "00000000-0000-4000-8000-000000000001", name: "HRP" };
    }
  }

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
