import { redirect } from "next/navigation";
import { Suspense } from "react";

import { createClient } from "@/lib/supabase/server";
import { hasEnvVars } from "@/lib/utils";

/**
 * `/` is only an entry point: send the visitor to the app or to the login page.
 * See docs/plan/wave1-plan-v1.1.md section 27.
 *
 * The session read must stay behind a <Suspense> boundary: with
 * `cacheComponents: true` reading cookies() outside one is a build error.
 */
async function HomeRedirect() {
  if (!hasEnvVars) {
    return redirect("/login");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return redirect(user ? "/dashboard" : "/login");
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <HomeRedirect />
    </Suspense>
  );
}
