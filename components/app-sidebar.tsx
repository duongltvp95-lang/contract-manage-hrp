"use client";

import {
  Building2,
  ChevronUp,
  FileText,
  LayoutDashboard,
  Loader2,
  ScrollText,
  Settings,
  User2,
} from "lucide-react";
import Image from "next/image";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ThemeSwitcher } from "@/components/theme-switcher";
import { ThemePalettePopover } from "@/components/theme-palette-popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { recordLogoutAction } from "@/app/login/actions";
import { createClient } from "@/lib/supabase/client";

/**
 * Wave 1 main navigation — docs/plan/wave1-plan-v1.1.md section 26, extended by
 * feature round 2 with the partner directory and round 3 with the admin audit
 * log.
 *
 * Order is the owner's: Tổng quan · Hợp đồng · Đối tác · Nhật ký · Cài đặt.
 * The "Nhật ký" item is hidden for non-administrators — the page also redirects
 * them to /dashboard, so the link would only be a dead end.
 */
const items: { title: string; url: string; icon: typeof FileText; admin?: boolean }[] = [
  { title: "Tổng quan", url: "/dashboard", icon: LayoutDashboard },
  { title: "Hợp đồng", url: "/contracts", icon: FileText },
  { title: "Đối tác", url: "/partners", icon: Building2 },
  { title: "Nhật ký", url: "/admin/logs", icon: ScrollText, admin: true },
  { title: "Cài đặt", url: "/settings", icon: Settings },
];

export type SidebarAccountInfo = {
  accountLabel: string | null;
  isAdmin: boolean;
  accentColor: string | null;
  backgroundColor: string | null;
  sidebarColor: string | null;
};

function SidebarNavPendingIndicator() {
  const { pending } = useLinkStatus();
  return (
    <Loader2
      aria-hidden="true"
      data-testid="sidebar-nav-pending"
      data-pending={pending ? "true" : "false"}
      className={
        pending
          ? "ml-auto h-3.5 w-3.5 shrink-0 animate-spin text-emerald-600/80 dark:text-emerald-400/80 opacity-80 transition-opacity delay-75 duration-150 group-data-[collapsible=icon]:hidden"
          : "ml-auto h-3.5 w-3.5 shrink-0 opacity-0 pointer-events-none group-data-[collapsible=icon]:hidden"
      }
    />
  );
}

export function AppSidebar({
  initialAccount,
}: {
  initialAccount?: SidebarAccountInfo | null;
} = {}) {
  const router = useRouter();
  const pathname = usePathname();
  const { isMobile, setOpenMobile } = useSidebar();

  const [fallbackAccountLabel, setFallbackAccountLabel] = useState<string | null>(null);
  const [fallbackIsAdmin, setFallbackIsAdmin] = useState(false);
  const [fallbackColors, setFallbackColors] = useState<{
    accent: string | null;
    background: string | null;
    sidebar: string | null;
  }>({
    accent: null,
    background: null,
    sidebar: null,
  });

  // Phản hồi thị giác tức thì ngay khung hình click đầu tiên (< 16ms),
  // tự hết hiệu lực ngay khi router cập nhật `pathname` sang tuyến mới.
  const [navIntent, setNavIntent] = useState<{
    fromPathname: string;
    targetUrl: string;
  } | null>(null);

  const serverColorsKey =
    initialAccount !== undefined
      ? `${initialAccount?.accentColor ?? ""}|${initialAccount?.backgroundColor ?? ""}|${initialAccount?.sidebarColor ?? ""}`
      : "client-fallback";

  const [optimisticColors, setOptimisticColors] = useState<{
    baseKey: string;
    accent: string | null;
    background: string | null;
    sidebar: string | null;
  } | null>(null);

  useEffect(() => {
    // Khi đã có dữ liệu tài khoản truyền từ Server Component xuống (dùng chung cache xác thực),
    // bỏ qua hoàn toàn 2 lượt gọi Supabase trùng lặp ở trình duyệt.
    if (initialAccount !== undefined) {
      return;
    }

    const supabase = createClient();

    supabase.auth
      .getUser()
      .then(async ({ data }) => {
        const user = data.user;
        if (!user) {
          setFallbackAccountLabel(null);
          setFallbackIsAdmin(false);
          return;
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, role, accent_color, background_color, sidebar_color")
          .eq("id", user.id)
          .maybeSingle();

        const typed = profile as {
          full_name: string | null;
          role: string;
          accent_color: string | null;
          background_color: string | null;
          sidebar_color: string | null;
        } | null;
        setFallbackAccountLabel(typed?.full_name?.trim() || user.email || null);
        setFallbackIsAdmin(typed?.role === "admin");
        setFallbackColors({
          accent: typed?.accent_color ?? null,
          background: typed?.background_color ?? null,
          sidebar: typed?.sidebar_color ?? null,
        });
      })
      .catch(() => {
        setFallbackAccountLabel(null);
        setFallbackIsAdmin(false);
      });
  }, [initialAccount]);

  const accountLabel =
    initialAccount !== undefined ? initialAccount?.accountLabel ?? null : fallbackAccountLabel;
  const isAdmin =
    initialAccount !== undefined ? Boolean(initialAccount?.isAdmin) : fallbackIsAdmin;
  const resolvedColors =
    optimisticColors && optimisticColors.baseKey === serverColorsKey
      ? optimisticColors
      : initialAccount !== undefined
        ? {
            accent: initialAccount?.accentColor ?? null,
            background: initialAccount?.backgroundColor ?? null,
            sidebar: initialAccount?.sidebarColor ?? null,
          }
        : fallbackColors;

  const effectiveTargetUrl =
    navIntent && navIntent.fromPathname === pathname ? navIntent.targetUrl : null;

  const handleSignOut = async () => {
    try {
      await recordLogoutAction();
    } catch {
      // Swallowed by design
    }
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex-row items-center gap-2 px-3 py-3 border-b border-sidebar-border/40">
        <Image
          src="/hrp-logo.webp"
          alt="HRP"
          width={36}
          height={36}
          priority
          data-testid="app-logo"
          className="h-9 w-9 shrink-0 object-contain group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8"
        />
        <div className="flex flex-col truncate group-data-[collapsible=icon]:hidden">
          <span className="truncate text-sm font-bold tracking-tight text-sidebar-foreground">
            HRP Contract
          </span>
          <span className="truncate text-[11px] text-muted-foreground font-medium">
            Quản lý hợp đồng
          </span>
        </div>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items
                .filter((item) => !item.admin || isAdmin)
                .map((item) => {
                  const isActive = effectiveTargetUrl
                    ? effectiveTargetUrl === item.url
                    : pathname.startsWith(item.url);

                  return (
                    <SidebarMenuItem key={item.title}>
                      <SidebarMenuButton
                        asChild
                        isActive={isActive}
                        onClick={(event) => {
                          if (
                            event.button === 0 &&
                            !event.metaKey &&
                            !event.ctrlKey &&
                            !event.shiftKey &&
                            !event.altKey &&
                            !pathname.startsWith(item.url)
                          ) {
                            setNavIntent({
                              fromPathname: pathname,
                              targetUrl: item.url,
                            });
                          }
                          if (isMobile) setOpenMobile(false);
                        }}
                        className="rounded-lg transition-colors hover:bg-emerald-500/[0.06] data-[active=true]:bg-emerald-500/10 data-[active=true]:text-emerald-700 dark:data-[active=true]:text-emerald-300 data-[active=true]:font-semibold data-[active=true]:hover:bg-emerald-500/15"
                      >
                        <Link href={item.url}>
                          <item.icon />
                          <span>{item.title}</span>
                          <SidebarNavPendingIndicator />
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1 px-1 pb-1">
          <ThemeSwitcher />
          <ThemePalettePopover
            accent={resolvedColors.accent}
            background={resolvedColors.background}
            sidebar={resolvedColors.sidebar}
            onChanged={({ accent, background, sidebar }) => {
              setOptimisticColors({
                baseKey: serverColorsKey,
                accent,
                background,
                sidebar,
              });
            }}
          />
        </div>
        <SidebarMenu>
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <SidebarMenuButton>
                  <User2 />
                  <span data-testid="sidebar-account">{accountLabel ?? "Tài khoản"}</span>
                  <ChevronUp className="ml-auto" />
                </SidebarMenuButton>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                className="w-[--radix-popper-anchor-width]"
              >
                <DropdownMenuItem asChild>
                  <Link href="/settings">
                    <span>Cài đặt</span>
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSignOut}>
                  <span>Đăng xuất</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
