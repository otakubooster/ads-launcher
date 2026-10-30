import { cookies } from "next/headers";
import { AppShell } from "@/components/shell/app-shell";
import { requireSession } from "@/lib/server/auth";
import { loadShellData } from "@/lib/server/shell";
import { SIDEBAR_COOKIE } from "@/lib/sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const [store, shell] = await Promise.all([cookies(), loadShellData(session.userId)]);
  return (
    <AppShell
      defaultCollapsed={store.get(SIDEBAR_COOKIE)?.value === "1"}
      user={{ name: session.name, email: session.email, role: session.role }}
      {...shell}
    >
      {children}
    </AppShell>
  );
}
