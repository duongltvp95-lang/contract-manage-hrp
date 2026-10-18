import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

export type SupabaseServerOptions = {
  abortSignal?: AbortSignal;
};

/**
 * Especially important if using Fluid compute: Don't put this client in a
 * global variable. Always create a new client within each function when using
 * it.
 */
export async function createClient(options?: SupabaseServerOptions) {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, {
                ...options,
                path: options?.path ?? "/",
                sameSite: options?.sameSite ?? "lax",
                secure: process.env.NODE_ENV === "production",
              }),
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have proxy refreshing
            // user sessions.
          }
        },
      },
      global: options?.abortSignal
        ? {
            fetch: (input, init) => {
              const signal = init?.signal
                ? AbortSignal.any([options.abortSignal!, init.signal])
                : options.abortSignal;
              return fetch(input, { ...init, signal });
            },
          }
        : undefined,
    },
  );
}
