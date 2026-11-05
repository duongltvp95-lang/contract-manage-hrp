import { redirect } from "next/navigation";

/** Keep old bookmarks usable after the application stopped using 2FA. */
export default function FormerMfaPage() {
  redirect("/settings");
}
