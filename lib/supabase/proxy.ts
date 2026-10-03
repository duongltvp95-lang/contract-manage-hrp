import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { hasEnvVars } from "../utils";

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  });

  // If the env vars are not set, skip proxy check. You can remove this
  // once you setup the project.
  if (!hasEnvVars) {
    return supabaseResponse;
  }

  // With Fluid compute, don't put this client in a global environment
  // variable. Always create a new one on each request.
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          supabaseResponse = NextResponse.next({
            request,
          });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Do not run code between createServerClient and
  // supabase.auth.getClaims(). A simple mistake could make it very hard to debug
  // issues with users being randomly logged out.

  // IMPORTANT: If you remove getClaims() and you use server-side rendering
  // with the Supabase client, your users may be randomly logged out.
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims;

  const pathname = request.nextUrl.pathname;
  // /login and /auth/* (including /auth/disabled) must stay reachable without a
  // session and for a deactivated account — otherwise the redirect below would
  // loop back into itself.
  const isPublicPath =
    pathname.startsWith("/login") || pathname.startsWith("/auth");

  // API callers must get JSON status codes, not an HTML login redirect.
  const isApiPath = pathname.startsWith("/api");

  /** Keeps the refreshed auth cookies on a hand-built response. */
  const withCookies = (response: NextResponse) => {
    supabaseResponse.cookies
      .getAll()
      .forEach((cookie) => response.cookies.set(cookie));
    return response;
  };

  if (!user) {
    if (isPublicPath) {
      return supabaseResponse;
    }

    if (isApiPath) {
      return withCookies(
        NextResponse.json(
          { error: "Bạn cần đăng nhập", code: "unauthenticated" },
          { status: 401 },
        ),
      );
    }

    // no user, potentially respond by redirecting the user to the login page
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    // Drop the original query string: carrying `?q=…&page=…` onto /login is
    // meaningless and leaks the previous filter state into the login URL.
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Authenticated. A valid session is not enough: an administrator may have
  // deactivated the account (owner decision, M3). Checking here — rather than
  // only in requireUser() — covers every protected path including /api/*, and
  // produces a hard refusal instead of a streamed redirect.
  if (!isPublicPath) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", user.sub)
      .maybeSingle();

    if (!profile || profile.is_active !== true) {
      if (isApiPath) {
        return withCookies(
          NextResponse.json(
            { error: "Tài khoản đã bị vô hiệu hoá", code: "forbidden" },
            { status: 403 },
          ),
        );
      }

      const url = request.nextUrl.clone();
      url.pathname = "/auth/disabled";
      return NextResponse.redirect(url);
    }
  }

  // IMPORTANT: You *must* return the supabaseResponse object as it is.
  // If you're creating a new response object with NextResponse.next() make sure to:
  // 1. Pass the request in it, like so:
  //    const myNewResponse = NextResponse.next({ request })
  // 2. Copy over the cookies, like so:
  //    myNewResponse.cookies.setAll(supabaseResponse.cookies.getAll())
  // 3. Change the myNewResponse object to fit your needs, but avoid changing
  //    the cookies!
  // 4. Finally:
  //    return myNewResponse
  // If this is not done, you may be causing the browser and server to go out
  // of sync and terminate the user's session prematurely!

  return supabaseResponse;
}
