"use client";

import { Fragment, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import { useModKey } from "@/lib/hooks/use-media-query";
import { NAV_ITEMS, SHORTCUTS } from "@/lib/nav";
import { useShell } from "./shell-provider";

const GO_TIMEOUT_MS = 1000;

function isTyping(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function overlayOpen() {
  return document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]') !== null;
}

/** ⌘K, G then D/A/L, / and ?. Row keys (J, K, X) are handled by tables. */
export function useGlobalShortcuts() {
  const router = useRouter();
  const { setCommandOpen, setShortcutsOpen } = useShell();

  useEffect(() => {
    let goPending: ReturnType<typeof setTimeout> | null = null;

    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen((open) => !open);
        return;
      }
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target) || overlayOpen()) return;

      const key = e.key.toLowerCase();
      if (goPending) {
        clearTimeout(goPending);
        goPending = null;
        const item = NAV_ITEMS.find((i) => i.goKey === key);
        if (item) {
          e.preventDefault();
          router.push(item.href);
        }
        return;
      }
      if (key === "g") {
        goPending = setTimeout(() => (goPending = null), GO_TIMEOUT_MS);
      } else if (e.key === "/") {
        const filter = document.querySelector<HTMLElement>("[data-filter-input]");
        if (filter) {
          e.preventDefault();
          filter.focus();
        }
      } else if (e.key === "?") {
        e.preventDefault();
        setShortcutsOpen(true);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      if (goPending) clearTimeout(goPending);
    };
  }, [router, setCommandOpen, setShortcutsOpen]);
}

export function ShortcutsDialog() {
  const { shortcutsOpen, setShortcutsOpen } = useShell();
  const mod = useModKey();

  return (
    <Dialog open={shortcutsOpen} onOpenChange={setShortcutsOpen}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>Everything in the app is reachable from the keyboard.</DialogDescription>
        </DialogHeader>
        <div className="grid max-h-[60vh] gap-5 overflow-y-auto px-5 py-4">
          {SHORTCUTS.map((group) => (
            <section key={group.group} className="grid gap-1">
              <h3 className="text-label font-medium text-slate-11">{group.group}</h3>
              <ul className="grid">
                {group.items.map((s) => (
                  <li key={s.label} className="flex h-8 items-center justify-between text-ui">
                    <span>{s.label}</span>
                    <span className="flex items-center gap-1 text-label text-slate-11">
                      {s.keys.map((k, i) => (
                        <Fragment key={k}>
                          {i > 0 && s.separator === "then" && <span>then</span>}
                          <Kbd>{k === "mod" ? mod : k}</Kbd>
                        </Fragment>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
