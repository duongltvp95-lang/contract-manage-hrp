import type { Metadata } from "next";
import { Geist } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { Toaster } from "@/components/ui/sonner";
import { getCurrentUser } from "@/lib/auth";
import "./globals.css";

const defaultUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(defaultUrl),
  title: "Contract Manager",
  description: "Hệ thống quản lý hợp đồng nội bộ",
};

const geistSans = Geist({
  variable: "--font-geist-sans",
  display: "swap",
  subsets: ["latin"],
});

// The root layout reads the session (for the server-driven accent), so it must
// be allowed to block — `instant = false` is the documented way (see
// docs/milestones/M4, deviation 11).
export const instant = false;

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Server-driven theme: the profile's preset keys become `data-accent` /
  // `data-background` / `data-sidebar` on <html>, so the theme is correct before
  // the first paint (no client flash). NULL (unauthenticated or default) simply
  // omits the attribute.
  const user = await getCurrentUser();
  const accent = user?.accentColor ?? null;
  const background = user?.backgroundColor ?? null;
  const sidebar = user?.sidebarColor ?? null;

  return (
    <html
      lang="vi"
      suppressHydrationWarning
      data-accent={accent ?? undefined}
      data-background={background ?? undefined}
      data-sidebar={sidebar ?? undefined}
    >
      <body className={`${geistSans.className} antialiased`}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          {children}
          <Toaster richColors closeButton position="top-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
