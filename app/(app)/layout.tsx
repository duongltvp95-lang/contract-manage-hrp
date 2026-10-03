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
      <main className="flex-1">
        <SidebarTrigger />
        {children}
      </main>
    </SidebarProvider>
  );
}
