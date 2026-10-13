import { describe, expect, it } from "vitest";
import { ExtractedContractSchema } from "@schemas/contract";
import {
  calculateDurationBetweenDates,
  cleanEntityName,
  extractDatesFromText,
  findBestMatchingCompany,
  findBestMatchingPartner,
  isInternalCompany,
  normalizeDurationText,
  normalizeVietnameseText,
  reconcileContractParties,
  resolveInternalCompanyKey,
} from "@/lib/ai/matching";

describe("AI Contract Extractor & Matching Unit Tests", () => {
  describe("ExtractedContractSchema", () => {
    it("validates full contract output", () => {
      const input = {
        contractNumber: "01/2026/HĐKT",
        signedDate: "2026-05-15",
        expiryDate: "2027-05-15",
        durationText: "12 tháng",
        partnerName: "Công ty Cổ phần Công nghệ Sao Mai",
        partnerTaxCode: "0109988776",
        partnerAddress: "Số 1 Đại Cồ Việt, Hai Bà Trưng, Hà Nội",
        companyName: "Công ty TNHH HR Partner Việt Nam",
        summary: "Cung cấp phần mềm quản lý",
      };

      const result = ExtractedContractSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contractNumber).toBe("01/2026/HĐKT");
        expect(result.data.signedDate).toBe("2026-05-15");
        expect(result.data.partnerTaxCode).toBe("0109988776");
        expect(result.data.partnerAddress).toBe("Số 1 Đại Cồ Việt, Hai Bà Trưng, Hà Nội");
      }
    });

    it("defaults missing fields to empty strings", () => {
      const input = {
        contractNumber: "02/HĐMB",
      };

      const result = ExtractedContractSchema.safeParse(input);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.contractNumber).toBe("02/HĐMB");
        expect(result.data.signedDate).toBe("");
        expect(result.data.expiryDate).toBe("");
        expect(result.data.partnerName).toBe("");
        expect(result.data.partnerTaxCode).toBe("");
        expect(result.data.partnerAddress).toBe("");
      }
    });
  });

  describe("normalizeVietnameseText", () => {
    it("removes diacritics and converts to lowercase", () => {
      expect(normalizeVietnameseText("Công Ty Cổ Phần ĐẦU TƯ")).toBe("cong ty co phan dau tu");
      expect(normalizeVietnameseText("  Đà   Nẵng  ")).toBe("da nang");
    });
  });

  describe("cleanEntityName", () => {
    it("removes legal company prefixes", () => {
      expect(cleanEntityName("Công ty Cổ phần Sao Mai")).toBe("sao mai");
      expect(cleanEntityName("Công ty TNHH MTV Công Nghệ Mới")).toBe("cong nghe moi");
      expect(cleanEntityName("Cty CP Giải Pháp Số")).toBe("giai phap so");
    });
  });

  describe("findBestMatchingPartner", () => {
    const mockPartners = [
      { id: "p1", name: "Công ty Cổ phần Sao Mai" },
      { id: "p2", name: "Công ty TNHH Dịch vụ Hoa Sen" },
      { id: "p3", name: "Tập đoàn Viễn thông An Phát" },
    ];

    it("matches exact name", () => {
      const match = findBestMatchingPartner("Công ty Cổ phần Sao Mai", mockPartners);
      expect(match?.id).toBe("p1");
    });

    it("matches cleaned name without company prefix", () => {
      const match = findBestMatchingPartner("Sao Mai", mockPartners);
      expect(match?.id).toBe("p1");
    });

    it("matches even if AI extracted different prefix format (e.g. Cty TNHH instead of Cty CP)", () => {
      const match = findBestMatchingPartner("Công ty TNHH Sao Mai", mockPartners);
      expect(match?.id).toBe("p1");
    });

    it("returns null when no matching partner is found", () => {
      const match = findBestMatchingPartner("Công ty TNHH Hoàn Toàn Khác", mockPartners);
      expect(match).toBeNull();
    });

    it("returns null for empty target", () => {
      expect(findBestMatchingPartner("", mockPartners)).toBeNull();
      expect(findBestMatchingPartner(undefined, mockPartners)).toBeNull();
    });
  });

  describe("Internal Company Identification & Reconciliation", () => {
    it("correctly identifies internal companies", () => {
      // New convention: CÔNG TY TNHH HRP VIỆT NAM là HRP
      expect(isInternalCompany("CÔNG TY TNHH HRP VIỆT NAM")).toBe(true);
      expect(isInternalCompany("CONG TY TNHH HRP VIET NAM")).toBe(true);
      expect(isInternalCompany("HRP VIỆT NAM")).toBe(true);
      expect(isInternalCompany("HRP")).toBe(true);

      // CÔNG TY TNHH HR PARTNER VIỆT NAM là HR VN
      expect(isInternalCompany("CÔNG TY TNHH HR PARTNER VIỆT NAM")).toBe(true);
      expect(isInternalCompany("CONG TY TNHH HR PARTNER VIET NAM")).toBe(true);
      expect(isInternalCompany("HR VN")).toBe(true);
      expect(isInternalCompany("CÔNG TY TNHH HR PARTNER")).toBe(true);

      // External companies
      expect(isInternalCompany("Công ty TNHH Công nghệ XPark")).toBe(false);
      expect(isInternalCompany("Cty CP Sao Mai")).toBe(false);
    });

    it("resolves exact company alias keys (HRP vs HR VN)", () => {
      // HRP
      expect(resolveInternalCompanyKey("CÔNG TY TNHH HRP VIỆT NAM")).toBe("HRP");
      expect(resolveInternalCompanyKey("CONG TY TNHH HRP VIET NAM")).toBe("HRP");
      expect(resolveInternalCompanyKey("HRP VIỆT NAM")).toBe("HRP");
      expect(resolveInternalCompanyKey("HRP")).toBe("HRP");

      // HR VN
      expect(resolveInternalCompanyKey("CÔNG TY TNHH HR PARTNER VIỆT NAM")).toBe("HR VN");
      expect(resolveInternalCompanyKey("CONG TY TNHH HR PARTNER VIET NAM")).toBe("HR VN");
      expect(resolveInternalCompanyKey("HR PARTNER VIỆT NAM")).toBe("HR VN");
      expect(resolveInternalCompanyKey("HR VN")).toBe("HR VN");

      // Backward compatibility fallback
      expect(resolveInternalCompanyKey("CÔNG TY TNHH HR PARTNER")).toBe("HRP");
      expect(resolveInternalCompanyKey("Công ty Khác")).toBeNull();
    });

    it("swaps parties if internal company was extracted as partnerName", () => {
      const swapped = reconcileContractParties({
        partnerName: "CÔNG TY TNHH HRP VIỆT NAM",
        companyName: "Công ty Cổ phần Công nghệ Sao Mai",
      });
      expect(swapped.partnerName).toBe("Công ty Cổ phần Công nghệ Sao Mai");
      expect(swapped.companyName).toBe("CÔNG TY TNHH HRP VIỆT NAM");
    });

    it("keeps external party as partner and internal company as companyName", () => {
      const preserved = reconcileContractParties({
        partnerName: "Công ty TNHH Đối Tác ABC",
        companyName: "CÔNG TY TNHH HRP VIỆT NAM",
      });
      expect(preserved.partnerName).toBe("Công ty TNHH Đối Tác ABC");
      expect(preserved.companyName).toBe("CÔNG TY TNHH HRP VIỆT NAM");
    });

    it("clears partnerName if only internal company was extracted in partnerName", () => {
      const cleared = reconcileContractParties({
        partnerName: "CÔNG TY TNHH HR PARTNER VIỆT NAM",
        companyName: "",
      });
      expect(cleared.partnerName).toBe("");
      expect(cleared.companyName).toBe("CÔNG TY TNHH HR PARTNER VIỆT NAM");
    });
  });

  describe("findBestMatchingCompany", () => {
    const mockCompanies = [
      { id: "c1", name: "HRP" },
      { id: "c2", name: "HR VN" },
    ];

    it("maps full company names to short internal company codes (HRP and HR VN)", () => {
      const matchVn = findBestMatchingCompany("CÔNG TY TNHH HR PARTNER VIỆT NAM", mockCompanies);
      expect(matchVn?.id).toBe("c2");
      expect(matchVn?.name).toBe("HR VN");

      const matchHrp = findBestMatchingCompany("CÔNG TY TNHH HRP VIỆT NAM", mockCompanies);
      expect(matchHrp?.id).toBe("c1");
      expect(matchHrp?.name).toBe("HRP");

      const matchHrpLegacy = findBestMatchingCompany("CÔNG TY TNHH HR PARTNER", mockCompanies);
      expect(matchHrpLegacy?.id).toBe("c1");
      expect(matchHrpLegacy?.name).toBe("HRP");
    });

    it("matches company by exact name", () => {
      const match = findBestMatchingCompany("HRP", mockCompanies);
      expect(match?.id).toBe("c1");
    });

    it("returns null when no company matches", () => {
      expect(findBestMatchingCompany("FPT Software", mockCompanies)).toBeNull();
    });
  });

  describe("cleanJsonText & resolveMimeType & normalizeDateToIso", () => {
    it("strips markdown fences around JSON", async () => {
      const { cleanJsonText } = await import("@/lib/ai/gemini");
      const wrapped = "```json\n{\"contractNumber\": \"12/HĐ\"}\n```";
      expect(cleanJsonText(wrapped)).toBe("{\"contractNumber\": \"12/HĐ\"}");
    });

    it("resolves mime type by file extension when mimeType is empty or generic", async () => {
      const { resolveMimeType } = await import("@/lib/ai/gemini");
      expect(resolveMimeType("sample.pdf", "")).toBe("application/pdf");
      expect(resolveMimeType("contract.jpg", "application/octet-stream")).toBe("image/jpeg");
      expect(resolveMimeType("doc.png", "")).toBe("image/png");
    });

    it("normalizes Vietnamese and ISO dates to standard YYYY-MM-DD", async () => {
      const { normalizeDateToIso } = await import("@/lib/ai/gemini");
      expect(normalizeDateToIso("15/03/2026")).toBe("2026-03-15");
      expect(normalizeDateToIso("1/5/2026")).toBe("2026-05-01");
      expect(normalizeDateToIso("2026-03-15")).toBe("2026-03-15");
      expect(normalizeDateToIso("2026/03/15")).toBe("2026-03-15");
      expect(normalizeDateToIso("invalid-date")).toBe("");
      expect(normalizeDateToIso("")).toBe("");
    });
  });

  describe("Duration Extraction & Normalization (normalizeDurationText)", () => {
    it("converts raw date range strings to duration (e.g. 1 năm, 6 tháng, 2 năm)", () => {
      // Direct scenario from user: "Từ ngày 20/12/2025 đến 20/12/2026"
      expect(
        normalizeDurationText({
          durationText: "Từ ngày 20/12/2025 đến 20/12/2026",
          signedDate: "2025-12-20",
          expiryDate: "2026-12-20",
        }),
      ).toBe("1 năm");

      // Without signedDate / expiryDate passed: parses dates directly from durationText
      expect(
        normalizeDurationText({
          durationText: "Từ ngày 20/12/2025 đến 20/12/2026",
        }),
      ).toBe("1 năm");

      // 6 months date range
      expect(
        normalizeDurationText({
          durationText: "từ 01/01/2025 đến 30/06/2025",
        }),
      ).toBe("6 tháng");

      // 2 years date range
      expect(
        normalizeDurationText({
          durationText: "Từ ngày 20/12/2025 đến ngày 20/12/2027",
        }),
      ).toBe("2 năm");
    });

    it("normalizes standard duration expressions into 1 năm, 2 năm, 6 tháng, etc.", () => {
      // 12 months -> 1 năm
      expect(normalizeDurationText({ durationText: "12 tháng" })).toBe("1 năm");
      expect(normalizeDurationText({ durationText: "24 tháng" })).toBe("2 năm");
      expect(normalizeDurationText({ durationText: "36 tháng" })).toBe("3 năm");

      // 1 năm / 01 năm / 02 năm
      expect(normalizeDurationText({ durationText: "01 năm" })).toBe("1 năm");
      expect(normalizeDurationText({ durationText: "1 năm" })).toBe("1 năm");
      expect(normalizeDurationText({ durationText: "02 năm" })).toBe("2 năm");
      expect(normalizeDurationText({ durationText: "2 năm" })).toBe("2 năm");

      // 6 tháng / 06 tháng / 3 tháng
      expect(normalizeDurationText({ durationText: "06 tháng" })).toBe("6 tháng");
      expect(normalizeDurationText({ durationText: "6 tháng" })).toBe("6 tháng");
      expect(normalizeDurationText({ durationText: "3 tháng" })).toBe("3 tháng");
      expect(normalizeDurationText({ durationText: "18 tháng" })).toBe("18 tháng");

      // Phrases with text around duration
      expect(
        normalizeDurationText({
          durationText: "Hợp đồng có thời hạn 01 (một) năm kể từ ngày ký",
        }),
      ).toBe("1 năm");
      expect(
        normalizeDurationText({
          durationText: "Thời hạn thực hiện hợp đồng là 06 (sáu) tháng",
        }),
      ).toBe("6 tháng");
    });

    it("handles open-ended / indefinite contract terms", () => {
      expect(normalizeDurationText({ durationText: "Không xác định thời hạn" })).toBe(
        "Không xác định thời hạn",
      );
      expect(normalizeDurationText({ durationText: "Vô thời hạn" })).toBe(
        "Không xác định thời hạn",
      );
      expect(normalizeDurationText({ durationText: "không thời hạn" })).toBe(
        "Không xác định thời hạn",
      );
    });

    it("calculates duration from signedDate and expiryDate when durationText is empty", () => {
      expect(
        normalizeDurationText({
          durationText: "",
          signedDate: "2025-12-20",
          expiryDate: "2026-12-20",
        }),
      ).toBe("1 năm");

      expect(
        normalizeDurationText({
          durationText: "",
          signedDate: "2025-12-20",
          expiryDate: "2027-12-20",
        }),
      ).toBe("2 năm");

      expect(
        normalizeDurationText({
          durationText: "",
          signedDate: "2025-12-20",
          expiryDate: "2026-06-20",
        }),
      ).toBe("6 tháng");
    });

    it("extractDatesFromText correctly parses multiple date formats", () => {
      expect(extractDatesFromText("Từ ngày 20/12/2025 đến ngày 20/12/2026")).toEqual([
        "2025-12-20",
        "2026-12-20",
      ]);
      expect(extractDatesFromText("2025-01-01 đến 2025-06-30")).toEqual([
        "2025-01-01",
        "2025-06-30",
      ]);
    });

    it("calculateDurationBetweenDates calculates exact contract intervals", () => {
      expect(calculateDurationBetweenDates("2025-12-20", "2026-12-20")).toBe("1 năm");
      expect(calculateDurationBetweenDates("2025-12-20", "2026-12-19")).toBe("1 năm");
      expect(calculateDurationBetweenDates("2025-01-01", "2025-12-31")).toBe("1 năm");
      expect(calculateDurationBetweenDates("2025-12-20", "2026-06-20")).toBe("6 tháng");
      expect(calculateDurationBetweenDates("2025-12-20", "2027-12-20")).toBe("2 năm");
      expect(calculateDurationBetweenDates("2025-12-20", "2028-12-20")).toBe("3 năm");
    });
  });
});

