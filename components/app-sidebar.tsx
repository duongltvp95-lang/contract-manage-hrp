"use client";

import { Building2, ChevronUp, FileText, LayoutDashboard, ScrollText, Settings, User2 } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
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
} from "@/components/ui/sidebar";
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

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [accountLabel, setAccountLabel] = useState<string | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [accentColor, setAccentColor] = useState<string | null>(null);
  const [backgroundColor, setBackgroundColor] = useState<string | null>(null);
  const [sidebarColor, setSidebarColor] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth
      .getUser()
      .then(async ({ data }) => {
        const user = data.user;
        if (!user) {
          setAccountLabel(null);
          setIsAdmin(false);
          return;
        }

        // Prefer the profile's display name so a change in Settings shows up
        // here too; the email stays the fallback when no name is set. The role
        // controls the "Nhật ký" item — the page redirects non-admins, so the
        // link must be hidden too. The accent/background/sidebar colors feed the
        // theme palette popover (round 13–14).
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
        setAccountLabel(typed?.full_name?.trim() || user.email || null);
        setIsAdmin(typed?.role === "admin");
        setAccentColor(typed?.accent_color ?? null);
        setBackgroundColor(typed?.background_color ?? null);
        setSidebarColor(typed?.sidebar_color ?? null);
      })
      .catch(() => {
        setAccountLabel(null);
        setIsAdmin(false);
      });
  }, []);

  const handleSignOut = async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  };

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="flex-row items-center gap-2 px-3 py-2">
        <Image
          src="/hrp-logo.webp"
          alt="HRP"
          width={36}
          height={36}
          priority
          data-testid="app-logo"
          className="h-9 w-9 shrink-0 rounded-md bg-white object-contain group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8"
        />
        <span className="truncate text-sm font-semibold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          Quản lý hợp đồng
        </span>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {items
                .filter((item) => !item.admin || isAdmin)
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(item.url)}
                      className="rounded-lg transition-colors hover:bg-gray-100 data-[active=true]:bg-primary/10 data-[active=true]:text-primary data-[active=true]:font-semibold data-[active=true]:hover:bg-primary/10"
                    >
                      <Link href={item.url}>
                        <item.icon />
                        <span>{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <div className="flex items-center gap-1 px-1 pb-1">
          <ThemeSwitcher />
          <ThemePalettePopover
            accent={accentColor}
            background={backgroundColor}
            sidebar={sidebarColor}
            onChanged={({ accent, background, sidebar }) => {
              setAccentColor(accent);
              setBackgroundColor(background);
              setSidebarColor(sidebar);
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
