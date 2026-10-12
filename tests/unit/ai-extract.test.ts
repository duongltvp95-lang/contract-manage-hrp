import { describe, expect, it } from "vitest";
import { ExtractedContractSchema } from "@schemas/contract";
import {
  cleanEntityName,
  findBestMatchingCompany,
  findBestMatchingPartner,
  normalizeVietnameseText,
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

  describe("findBestMatchingCompany", () => {
    const mockCompanies = [
      { id: "c1", name: "Công ty TNHH HR Partner" },
      { id: "c2", name: "Công ty Cổ phần HR Partner Việt Nam" },
    ];

    it("matches company by partial or cleaned name", () => {
      const match = findBestMatchingCompany("HR Partner", mockCompanies);
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
});
