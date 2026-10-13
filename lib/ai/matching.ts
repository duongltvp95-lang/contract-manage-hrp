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
 * - CÔNG TY TNHH HRP VIỆT NAM (HRP)
 * - CÔNG TY TNHH HR PARTNER VIỆT NAM (HR VN)
 */
export function isInternalCompany(name: string | undefined | null): boolean {
  if (!name || !name.trim()) return false;
  return resolveInternalCompanyKey(name) !== null;
}

/**
 * Resolves which of our 2 internal companies ("HR VN" or "HRP") a given name refers to.
 * Quy ước mới:
 * - CÔNG TY TNHH HRP VIỆT NAM -> "HRP"
 * - CÔNG TY TNHH HR PARTNER VIỆT NAM -> "HR VN"
 */
export function resolveInternalCompanyKey(name: string | undefined | null): "HR VN" | "HRP" | null {
  if (!name || !name.trim()) return null;
  const normalized = normalizeVietnameseText(name);

  // 1. Matches HRP:
  // "CÔNG TY TNHH HRP VIỆT NAM", "HRP VIỆT NAM", "HRP", "CÔNG TY TNHH HRP", "CONG TY TNHH HRP VIET NAM"
  if (/\bhrp\b/.test(normalized)) {
    return "HRP";
  }

  // 2. Matches HR VN:
  // "CÔNG TY TNHH HR PARTNER VIỆT NAM", "HR PARTNER VIỆT NAM", "HR VN", "HR VIỆT NAM", "CONG TY TNHH HR PARTNER VIET NAM"
  if (
    normalized === "hr vn" ||
    /\bhr vn\b/.test(normalized) ||
    normalized.includes("hr viet nam") ||
    (
      (normalized.includes("hr partner") || normalized.includes("hrpartner")) &&
      (normalized.includes("viet nam") || /\bvn\b/.test(normalized))
    )
  ) {
    return "HR VN";
  }

  // 3. Fallback compatibility for "HR Partner" without "Việt Nam":
  if (normalized.includes("hr partner") || normalized.includes("hrpartner")) {
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

/**
 * Extracts all recognized dates (DD/MM/YYYY, YYYY-MM-DD, Vietnamese long dates) from a text string.
 * Returns ISO strings (YYYY-MM-DD).
 */
export function extractDatesFromText(text: string): string[] {
  if (!text) return [];
  const results: string[] = [];

  // Match Vietnamese long date: ngày DD tháng MM năm YYYY
  const viDateRegex = /ngày\s*(\d{1,2})\s*tháng\s*(\d{1,2})\s*năm\s*(\d{4})/gi;
  let match: RegExpExecArray | null;
  while ((match = viDateRegex.exec(text)) !== null) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    results.push(`${year}-${month}-${day}`);
  }

  // Match DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
  const dmyRegex = /\b(\d{1,2})[/\.-](\d{1,2})[/\.-](\d{4})\b/g;
  while ((match = dmyRegex.exec(text)) !== null) {
    const day = match[1].padStart(2, "0");
    const month = match[2].padStart(2, "0");
    const year = match[3];
    results.push(`${year}-${month}-${day}`);
  }

  // Match YYYY-MM-DD or YYYY/MM/DD
  const isoRegex = /\b(\d{4})[/-](\d{1,2})[/-](\d{1,2})\b/g;
  while ((match = isoRegex.exec(text)) !== null) {
    const year = match[1];
    const month = match[2].padStart(2, "0");
    const day = match[3].padStart(2, "0");
    results.push(`${year}-${month}-${day}`);
  }

  return results;
}

/**
 * Calculates a human-readable contract duration (e.g. "6 tháng", "1 năm", "2 năm")
 * between two ISO date strings (YYYY-MM-DD).
 */
export function calculateDurationBetweenDates(startIso: string, endIso: string): string {
  const d1 = new Date(`${startIso}T00:00:00Z`);
  const d2 = new Date(`${endIso}T00:00:00Z`);
  if (Number.isNaN(d1.getTime()) || Number.isNaN(d2.getTime()) || d2 <= d1) {
    return "";
  }

  const diffDays = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 20) {
    return `${diffDays} ngày`;
  }

  let months = (d2.getUTCFullYear() - d1.getUTCFullYear()) * 12 + (d2.getUTCMonth() - d1.getUTCMonth());
  const dayDiff = d2.getUTCDate() - d1.getUTCDate();
  if (dayDiff >= 25) months += 1;
  else if (dayDiff <= -25) months -= 1;

  const approxMonths = Math.round((diffDays + 1) / 30.4375);
  const finalMonths =
    Math.abs(months - approxMonths) <= 1
      ? approxMonths % 12 === 0
        ? approxMonths
        : months > 0
          ? months
          : approxMonths
      : approxMonths;

  if (finalMonths <= 0) return "";
  if (finalMonths % 12 === 0) {
    const years = finalMonths / 12;
    return `${years} năm`;
  }
  return `${finalMonths} tháng`;
}

export type DurationInput = {
  durationText?: string | null;
  signedDate?: string | null;
  expiryDate?: string | null;
};

/**
 * Normalizes raw extracted durationText into standard Vietnamese contract terms:
 * - "6 tháng", "1 năm", "2 năm", "3 năm", "Không xác định thời hạn"
 * - Converts raw date ranges ("Từ ngày 20/12/2025 đến 20/12/2026") into months/years ("1 năm")
 * - Converts "12 tháng" -> "1 năm", "24 tháng" -> "2 năm", "01 năm" -> "1 năm", "06 tháng" -> "6 tháng"
 * - Uses signedDate and expiryDate as fallback if durationText is empty or date range.
 */
export function normalizeDurationText(input: DurationInput): string {
  const raw = (input?.durationText ?? "").trim();
  const signed = (input?.signedDate ?? "").trim();
  const expiry = (input?.expiryDate ?? "").trim();

  // 1. Indefinite / Open-ended contracts
  if (/không\s*xác\s*định|vô\s*thời\s*hạn|không\s*thời\s*hạn/i.test(raw)) {
    return "Không xác định thời hạn";
  }

  // 2. Check if raw contains a date range (e.g. 'Từ ngày 20/12/2025 đến 20/12/2026')
  const datesInRaw = extractDatesFromText(raw);
  if (datesInRaw.length >= 2) {
    const calculated = calculateDurationBetweenDates(datesInRaw[0], datesInRaw[1]);
    if (calculated) return calculated;
  }

  // 3. Check if raw has explicit duration expression (e.g. '12 tháng', '1 năm', '02 năm', '6 tháng')
  // We match small numbers (1-50) to avoid matching full calendar years like "năm 2026"
  const yearMatch = raw.match(/\b(0?[1-9]|[1-4][0-9])\s*(?:\([^\)]+\)\s*)?năm\b/i);
  const monthMatch = raw.match(/\b(0?[1-9]|[1-9][0-9])\s*(?:\([^\)]+\)\s*)?tháng\b/i);

  if (yearMatch && monthMatch) {
    const y = parseInt(yearMatch[1], 10);
    const m = parseInt(monthMatch[1], 10);
    return `${y} năm ${m} tháng`;
  }

  if (yearMatch) {
    const y = parseInt(yearMatch[1], 10);
    return `${y} năm`;
  }

  if (monthMatch) {
    const m = parseInt(monthMatch[1], 10);
    if (m > 0 && m % 12 === 0) {
      return `${m / 12} năm`;
    }
    return `${m} tháng`;
  }

  // 4. Fallback: if raw is empty or unparsable date, calculate from signedDate and expiryDate
  if (signed && expiry) {
    const calculated = calculateDurationBetweenDates(signed, expiry);
    if (calculated) return calculated;
  }

  // 5. If raw was just a date or contains date fragments, do not keep raw date strings as duration
  if (datesInRaw.length > 0) {
    return "";
  }

  return raw;
}
