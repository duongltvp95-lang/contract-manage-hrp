import { PassThrough } from "node:stream";
import React from "react";
import { renderToPipeableStream } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockRequireUser = vi.fn();
const mockGetContractMetrics = vi.fn();
const mockCountUndatedContracts = vi.fn();
const mockCountNoFileContracts = vi.fn();
const mockGetRecentContracts = vi.fn();
const mockGetExpiringContracts = vi.fn();
const mockGetUndatedContracts = vi.fn();
const mockListContracts = vi.fn();

vi.mock("@/lib/auth", () => ({
  requireUser: () => mockRequireUser(),
}));

vi.mock("@/lib/services/dashboard", () => ({
  DASHBOARD_LIST_LIMIT: 5,
  expiringWindowBounds: () => ({ from: "2026-11-05", to: "2027-02-03" }),
  getContractMetrics: (...args: unknown[]) => mockGetContractMetrics(...args),
  countUndatedContracts: (...args: unknown[]) => mockCountUndatedContracts(...args),
  countNoFileContracts: (...args: unknown[]) => mockCountNoFileContracts(...args),
  getRecentContracts: (...args: unknown[]) => mockGetRecentContracts(...args),
  getExpiringContracts: (...args: unknown[]) => mockGetExpiringContracts(...args),
  getUndatedContracts: (...args: unknown[]) => mockGetUndatedContracts(...args),
}));

vi.mock("@/lib/services/contracts", () => ({
  listContracts: (...args: unknown[]) => mockListContracts(...args),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => React.createElement("a", { href, ...rest }, children),
}));

vi.mock("@/components/contracts/contracts-toolbar", () => ({
  ContractsToolbar: () =>
    React.createElement("div", { "data-testid": "contracts-toolbar-stub" }),
}));

vi.mock("@/components/contracts/contracts-table", () => ({
  ContractsTable: ({ rows }: { rows: { contract_number: string }[] }) =>
    React.createElement(
      "div",
      { "data-testid": "contracts-table-stub" },
      rows.map((r) => r.contract_number).join(","),
    ),
}));

vi.mock("@/components/contracts/contracts-pagination", () => ({
  ContractsPagination: () =>
    React.createElement("div", { "data-testid": "contracts-pagination-stub" }),
}));

import DashboardPage from "@/app/(app)/dashboard/page";
import ContractsPage from "@/app/(app)/contracts/page";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function streamElement(element: React.ReactElement) {
  let buffer = "";
  let doneResolve!: () => void;
  const done = new Promise<void>((r) => {
    doneResolve = r;
  });

  const writable = new PassThrough();
  writable.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
  });
  writable.on("end", () => {
    doneResolve();
  });

  const { pipe } = renderToPipeableStream(element, {
    onShellReady() {
      pipe(writable);
    },
  });

  return {
    getHtml: () => buffer,
    done,
  };
}

describe("Wave 2 — Streaming độc lập trên Tổng quan và Hợp đồng", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequireUser.mockResolvedValue({
      id: "u-1",
      email: "admin@hrpartner.vn",
      fullName: "Quản trị viên",
      organizationId: "org-1",
      role: "admin",
      accentColor: null,
      backgroundColor: null,
      sidebarColor: null,
    });
  });

  it("Tổng quan: hiển thị thẻ số liệu và bảng gần đây ngay cả khi truy vấn hợp đồng không thời hạn còn đang chờ", async () => {
    const slowUndated = createDeferred<{
      ok: true;
      data: { rows: never[]; total: number };
    }>();

    mockGetContractMetrics.mockResolvedValue({
      ok: true,
      data: { total: 48, active: 40, expiringSoon: 5, expired: 8, archived: 2 },
    });
    mockCountUndatedContracts.mockResolvedValue({ ok: true, data: 3 });
    mockGetRecentContracts.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "c-recent",
          organization_id: "org-1",
          contract_number: "HD-NHANH-001",
          partner_id: "p-1",
          partner_text: null,
          company_id: null,
          signed_date: "2026-10-01",
          expiry_date: "2027-10-01",
          duration_text: "12 tháng",
          notes: null,
          archived_at: null,
          created_at: "2026-10-01T00:00:00Z",
          updated_at: "2026-10-01T00:00:00Z",
          partnerName: "Đối tác Nhanh",
          companies: ["HRP"],
        },
      ],
    });
    mockGetExpiringContracts.mockResolvedValue({ ok: true, data: [] });
    mockGetUndatedContracts.mockReturnValue(slowUndated.promise);

    const stream = streamElement(React.createElement(DashboardPage));
    await new Promise((r) => setTimeout(r, 40));

    // Khi getUndatedContracts vẫn đang treo, các thẻ số liệu và bảng Hợp đồng gần đây đã được đẩy xuống trình duyệt!
    const midHtml = stream.getHtml();
    expect(midHtml).toContain('data-testid="metric-total"');
    expect(midHtml).toContain("48");
    expect(midHtml).toContain("HD-NHANH-001");
    expect(midHtml).not.toMatch(/3(?:<!-- -->)? hợp đồng/);

    slowUndated.resolve({ ok: true, data: { rows: [], total: 3 } });
    await stream.done;

    const finalHtml = stream.getHtml();
    expect(finalHtml).toMatch(/3(?:<!-- -->)? hợp đồng/);
  });

  it("Hợp đồng: hiển thị các tab, thanh công cụ và danh sách hợp đồng trước khi các bộ đếm tab hoàn tất", async () => {
    const slowMetrics = createDeferred<{
      ok: true;
      data: { total: number; active: number; expiringSoon: number; expired: number; archived: number };
    }>();

    mockListContracts.mockResolvedValue({
      ok: true,
      data: {
        rows: [{ contract_number: "HD-DANH-SACH-99" }],
        total: 1,
        pageCount: 1,
      },
    });
    mockGetContractMetrics.mockReturnValue(slowMetrics.promise);
    mockCountUndatedContracts.mockResolvedValue({ ok: true, data: 4 });
    mockCountNoFileContracts.mockResolvedValue({ ok: true, data: 2 });

    const stream = streamElement(
      React.createElement(ContractsPage, {
        searchParams: Promise.resolve({}),
      }),
    );
    await new Promise((r) => setTimeout(r, 40));

    // Danh sách hợp đồng, thanh công cụ và các nút tab đã hiển thị ngay dù bộ đếm còn đang tính!
    const midHtml = stream.getHtml();
    expect(midHtml).toContain('data-testid="contracts-tabs"');
    expect(midHtml).toContain('data-testid="contract-tab-active"');
    expect(midHtml).toContain('data-testid="contracts-toolbar-stub"');
    expect(midHtml).toContain("HD-DANH-SACH-99");

    slowMetrics.resolve({
      ok: true,
      data: { total: 95, active: 88, expiringSoon: 6, expired: 7, archived: 1 },
    });
    await stream.done;

    const finalHtml = stream.getHtml();
    expect(finalHtml).toContain(">88<");
    expect(finalHtml).toContain(">4<");
    expect(finalHtml).toContain(">2<");
  });
});
