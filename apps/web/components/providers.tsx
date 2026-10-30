"use client";

import * as React from "react";
import { ThemeProvider, useTheme } from "next-themes";
import { Toaster } from "sonner";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <ThemedToaster />
    </ThemeProvider>
  );
}

function ThemedToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : "light"}
      position="bottom-right"
      toastOptions={{ className: "font-sans! text-ui! rounded-card!" }}
      style={
        {
          "--normal-bg": "var(--slate-1)",
          "--normal-border": "var(--slate-6)",
          "--normal-text": "var(--slate-12)",
        } as React.CSSProperties
      }
    />
  );
}
