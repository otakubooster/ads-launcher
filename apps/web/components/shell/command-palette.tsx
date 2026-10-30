"use client";

import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Keyboard, Moon, OctagonX, Pause, Plus, RefreshCw, ScrollText, ShieldCheck, Sun } from "lucide-react";
import { toast } from "sonner";
import {
  CommandDialog,
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { Kbd } from "@/components/ui/kbd";
import { LAUNCH_FEATURES } from "@/lib/features";
import { NAV_ITEMS } from "@/lib/nav";
import { useShell } from "./shell-provider";

export function CommandPalette() {
  const router = useRouter();
  const { resolvedTheme, setTheme } = useTheme();
  const { commandOpen, setCommandOpen, setShortcutsOpen, query } = useShell();

  function run(action: () => void) {
    setCommandOpen(false);
    action();
  }

  return (
    <CommandDialog
      open={commandOpen}
      onOpenChange={setCommandOpen}
      title="Command palette"
      description="Jump to a page or run an action"
    >
      <Command loop>
        <CommandInput placeholder="Search pages, campaigns, ads, presets or actions…" />
        <CommandList>
          <CommandEmpty>
            No results. Campaigns, ad sets, ads and presets become searchable after the first sync.
          </CommandEmpty>
          <CommandGroup heading="Actions">
            {LAUNCH_FEATURES && (
              <CommandItem onSelect={() => run(() => router.push("/launch"))}>
                <Plus />
                New launch
              </CommandItem>
            )}
            <CommandItem disabled>
              <Pause />
              Pause selected
              <span className="ml-auto text-label text-slate-11">Select rows in Ads first</span>
            </CommandItem>
            {LAUNCH_FEATURES && (
              <CommandItem onSelect={() => run(() => router.push("/launches"))}>
                <ScrollText />
                Open launch log
              </CommandItem>
            )}
            <CommandItem onSelect={() => run(() => router.push("/approvals"))}>
              <ShieldCheck />
              Review approvals
            </CommandItem>
            <CommandItem value="kill switch stop everything" onSelect={() => run(() => router.push("/settings#kill-switch"))}>
              <OctagonX />
              Kill switch
            </CommandItem>
            <CommandItem
              onSelect={() =>
                run(() => toast("Nothing to sync yet", { description: "Connect a Business Manager in Settings first." }))
              }
            >
              <RefreshCw />
              Refresh data
            </CommandItem>
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Go to">
            {NAV_ITEMS.map((item) => (
              <CommandItem key={item.href} value={`go ${item.label}`} onSelect={() => run(() => router.push(`${item.href}${query}`))}>
                <item.icon />
                {item.label}
                {item.goKey && (
                  <CommandShortcut>
                    <Kbd>G</Kbd>
                    <Kbd>{item.goKey.toUpperCase()}</Kbd>
                  </CommandShortcut>
                )}
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandSeparator />
          <CommandGroup heading="Preferences">
            <CommandItem onSelect={() => run(() => setTheme(resolvedTheme === "dark" ? "light" : "dark"))}>
              {resolvedTheme === "dark" ? <Sun /> : <Moon />}
              Switch to {resolvedTheme === "dark" ? "light" : "dark"} theme
            </CommandItem>
            <CommandItem onSelect={() => run(() => setShortcutsOpen(true))}>
              <Keyboard />
              Keyboard shortcuts
              <CommandShortcut>
                <Kbd>?</Kbd>
              </CommandShortcut>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
