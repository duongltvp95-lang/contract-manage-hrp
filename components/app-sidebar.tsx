"use client";

import { ChevronUp, FileText, LayoutDashboard, Settings, User2 } from "lucide-react";
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
 * Wave 1 main navigation — docs/plan/wave1-plan-v1.1.md section 26.
 * Exactly three items. Processing / Review / AI / Partners are NOT shown.
 * UI language is Vietnamese (project standard).
 */
const items = [
  { title: "Tổng quan", url: "/dashboard", icon: LayoutDashboard },
  { title: "Hợp đồng", url: "/contracts", icon: FileText },
  { title: "Cài đặt", url: "/settings", icon: Settings },
];

export function AppSidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const [accountLabel, setAccountLabel] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();

    supabase.auth
      .getUser()
      .then(async ({ data }) => {
        const user = data.user;
        if (!user) {
          setAccountLabel(null);
          return;
        }

        // Prefer the profile's display name so a change in Settings shows up
        // here too; the email stays the fallback when no name is set.
        const { data: profile } = await supabase
          .from("profiles")
          .select("full_name")
          .eq("id", user.id)
          .maybeSingle();

        const fullName = (profile as { full_name: string | null } | null)?.full_name;
        setAccountLabel(fullName?.trim() || user.email || null);
      })
      .catch(() => setAccountLabel(null));
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
              {items.map((item) => (
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
