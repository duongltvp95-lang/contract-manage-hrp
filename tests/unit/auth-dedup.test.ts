import { AsyncLocalStorage } from "node:async_hooks";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Mô phỏng chính xác cây khóa theo `arguments.length` của `React.cache` trên React 19 Server:
 * `fn()` (0 đối số) và `fn(undefined)` (1 đối số = undefined) nằm ở 2 nút khác nhau.
 * Nhờ đó bài kiểm thử này bắt được ngay lỗi tách đôi khóa cache giữa Layout và Page.
 */
type CacheNode = {
  hasValue: boolean;
  value: unknown;
  primitiveChildren: Map<unknown, CacheNode>;
  objectChildren: WeakMap<object, CacheNode>;
};

type AnyFn = (...args: never[]) => unknown;

const renderScope = new AsyncLocalStorage<Map<AnyFn, CacheNode>>();

function createNode(): CacheNode {
  return {
    hasValue: false,
    value: undefined,
    primitiveChildren: new Map(),
    objectChildren: new WeakMap(),
  };
}

function runInRenderScope<T>(fn: () => Promise<T>): Promise<T> {
  return renderScope.run(new Map(), fn);
}

vi.mock("react", async () => {
  const actual = await vi.importActual<typeof import("react")>("react");
  return {
    ...actual,
    cache: <T extends (...args: never[]) => unknown>(fn: T): T => {
      const cached = function (...args: unknown[]) {
        const store = renderScope.getStore();
        if (!store) {
          return fn(...(args as never[]));
        }
        let node = store.get(fn);
        if (!node) {
          node = createNode();
          store.set(fn, node);
        }
        for (let i = 0; i < args.length; i += 1) {
          const arg = args[i];
          if (
            (typeof arg === "object" && arg !== null) ||
            typeof arg === "function"
          ) {
            let next = node.objectChildren.get(arg);
            if (!next) {
              next = createNode();
              node.objectChildren.set(arg, next);
            }
            node = next;
          } else {
            let next = node.primitiveChildren.get(arg);
            if (!next) {
              next = createNode();
              node.primitiveChildren.set(arg, next);
            }
            node = next;
          }
        }
        if (node.hasValue) {
          return node.value;
        }
        const result = fn(...(args as never[]));
        node.hasValue = true;
        node.value = result;
        return result;
      };
      return cached as unknown as T;
    },
  };
});

const mockCreateClient = vi.fn();
const mockRedirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock("@/lib/utils", () => ({
  hasEnvVars: true,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => mockRedirect(url),
}));

import { getCurrentUser, requireUser, resolveAccess } from "@/lib/auth";

describe("lib/auth — dùng chung cache xác thực & đọc song song hồ sơ", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("dùng chung đúng 1 lần gọi Supabase giữa getCurrentUser(), requireUser() và resolveAccess({}) trong cùng lượt tải", async () => {
    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: "user-1" } } },
    });
    const getUser = vi.fn().mockResolvedValue({
      data: { user: { id: "user-1", email: "admin@hrpartner.vn" } },
    });
    const maybeSingle = vi.fn().mockResolvedValue({
      data: {
        id: "user-1",
        organization_id: "org-1",
        full_name: "Nguyễn Quản Trị",
        role: "admin",
        is_active: true,
        accent_color: "teal",
        background_color: null,
        sidebar_color: "navy",
      },
      error: null,
    });

    mockCreateClient.mockResolvedValue({
      auth: { getSession, getUser },
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            abortSignal: () => ({ maybeSingle }),
            maybeSingle,
          }),
        }),
      })),
    });

    await runInRenderScope(async () => {
      // Mô phỏng RootLayout -> AppSidebarServer -> Page cùng gọi xác thực theo nhiều cách khác nhau
      const layoutUser = await getCurrentUser();
      const sidebarUser = await getCurrentUser(undefined);
      const pageUser = await requireUser();
      const emptyOptsAccess = await resolveAccess({});

      expect(layoutUser?.id).toBe("user-1");
      expect(sidebarUser?.fullName).toBe("Nguyễn Quản Trị");
      expect(pageUser.organizationId).toBe("org-1");
      expect(emptyOptsAccess).toMatchObject({
        status: "ok",
        user: { id: "user-1", role: "admin", accentColor: "teal", sidebarColor: "navy" },
      });
    });

    expect(mockCreateClient).toHaveBeenCalledTimes(1);
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(maybeSingle).toHaveBeenCalledTimes(1);
  });

  it("chạy song song auth.getUser() và truy vấn profiles khi cookie phiên đã có userId", async () => {
    const events: string[] = [];
    let releaseUser!: () => void;
    const userGate = new Promise<void>((resolve) => {
      releaseUser = resolve;
    });

    const getSession = vi.fn().mockResolvedValue({
      data: { session: { user: { id: "user-parallel" } } },
    });
    const getUser = vi.fn().mockImplementation(async () => {
      events.push("getUser:start");
      await userGate;
      events.push("getUser:end");
      return {
        data: { user: { id: "user-parallel", email: "user@hrpartner.vn" } },
      };
    });
    const maybeSingle = vi.fn().mockImplementation(async () => {
      events.push("profiles:start");
      return {
        data: {
          id: "user-parallel",
          organization_id: "org-1",
          full_name: "Nhân sự A",
          role: "user",
          is_active: true,
          accent_color: null,
          background_color: null,
          sidebar_color: null,
        },
        error: null,
      };
    });

    mockCreateClient.mockResolvedValue({
      auth: { getSession, getUser },
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({ maybeSingle }),
        }),
      })),
    });

    const pendingPromise = runInRenderScope(() => resolveAccess());

    // Cho microtasks chạy tới điểm treo userGate: truy vấn profiles phải đã khởi chạy trước khi getUser kết thúc
    await new Promise((r) => setTimeout(r, 10));
    expect(events).toEqual(["getUser:start", "profiles:start"]);

    releaseUser();
    const res = await pendingPromise;
    expect(events).toEqual(["getUser:start", "profiles:start", "getUser:end"]);
    expect(res).toMatchObject({
      status: "ok",
      user: { id: "user-parallel", role: "user" },
    });
  });

  it("vẫn từ chối tài khoản bị vô hiệu hóa (disabled) và chuyển hướng đúng tới /auth/disabled", async () => {
    mockCreateClient.mockResolvedValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({
          data: { session: { user: { id: "user-disabled" } } },
        }),
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: "user-disabled", email: "locked@hrpartner.vn" } },
        }),
      },
      from: vi.fn(() => ({
        select: () => ({
          eq: () => ({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: "user-disabled",
                organization_id: "org-1",
                full_name: "Tài khoản khóa",
                role: "user",
                is_active: false,
                accent_color: null,
                background_color: null,
                sidebar_color: null,
              },
              error: null,
            }),
          }),
        }),
      })),
    });

    await runInRenderScope(async () => {
      const current = await getCurrentUser();
      expect(current).toBeNull();
      await expect(requireUser()).rejects.toThrow("NEXT_REDIRECT:/auth/disabled");
    });
  });

  it("không gọi thừa bảng profiles khi khách chưa đăng nhập (không có session)", async () => {
    const fromSpy = vi.fn();
    mockCreateClient.mockResolvedValue({
      auth: {
        getSession: vi.fn().mockResolvedValue({ data: { session: null } }),
        getUser: vi.fn().mockResolvedValue({ data: { user: null } }),
      },
      from: fromSpy,
    });

    const access = await runInRenderScope(() => resolveAccess());
    expect(access).toEqual({ status: "unauthenticated" });
    expect(fromSpy).not.toHaveBeenCalled();
  });
});
