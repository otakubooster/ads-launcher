import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { LAUNCH_FEATURES, isLaunchPath } from "@/lib/features";

/** Keeps Supabase auth cookies fresh. A no-op without Supabase (dev auth). */
export async function proxy(request: NextRequest) {
  if (!LAUNCH_FEATURES && isLaunchPath(request.nextUrl.pathname)) return NextResponse.redirect(new URL("/ads", request.url));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.next();

  let response = NextResponse.next({ request });
  const supabase = createServerClient(url, anon, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (list) => {
        for (const { name, value } of list) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of list) response.cookies.set(name, value, options);
      },
    },
  });
  await supabase.auth.getUser();
  return response;
}

export const config = {
  // api/files streams uploads of any size; middleware would cap and truncate the body at 10 MB.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/files/).*)"],
};
