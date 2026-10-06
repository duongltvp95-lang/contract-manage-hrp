"use client";

import { Building2, ChevronUp, FileText, LayoutDashboard, ScrollText, Settings, User2 } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { ThemeSwitcher } from "@/components/theme-switcher";
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
  SidebarGroupLabel,
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
        // link must be hidden too.
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name, role")
          .eq("id", user.id)
          .maybeSingle();

        const typed = profile as { full_name: string | null; role: string } | null;
        setAccountLabel(typed?.full_name?.trim() || user.email || null);
        setIsAdmin(typed?.role === "admin");
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
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Quản lý hợp đồng</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {items
                .filter((item) => !item.admin || isAdmin)
                .map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={pathname.startsWith(item.url)}
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
        <div className="flex items-center px-1 pb-1">
          <ThemeSwitcher />
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
