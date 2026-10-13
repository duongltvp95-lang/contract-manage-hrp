import { AppSidebar } from "@/components/app-sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

/**
 * Application shell for every authenticated route
 * (/dashboard, /contracts, /settings).
 *
 * Reused from the base repository's dashboard layout: sidebar framework,
 * provider and trigger are unchanged. Access control lives in the individual
 * pages (see lib/auth.ts) so this layout stays a pure shell.
 */
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider>
      <AppSidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Thanh điều hướng cố định trên thiết bị di động */}
        <header className="sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-background/95 px-4 backdrop-blur md:hidden">
          <div className="flex items-center gap-2.5">
            <SidebarTrigger className="h-9 w-9" />
            <span className="text-sm font-semibold text-foreground">Quản lý hợp đồng</span>
          </div>
        </header>

        {/* Nút bật/tắt sidebar trên desktop */}
        <div className="hidden md:flex items-center px-4 py-2">
          <SidebarTrigger />
        </div>

        <main className="flex-1 bg-background min-w-0">
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
