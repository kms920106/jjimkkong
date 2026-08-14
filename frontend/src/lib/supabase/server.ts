import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

/**
 * Per-request Supabase client. Never cache or share the returned client across
 * requests — it is bound to this request's cookie store.
 */
export async function createClient() {
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
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Server Components cannot write cookies. The proxy refreshes the
            // session on every request, so dropping the write here is safe.
          }
        },
      },
    },
  );
}
