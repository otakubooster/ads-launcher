"use client";

import Link from "next/link";
import { Check, ChevronsUpDown, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Command, CommandGroup, CommandInput, CommandItem, CommandList, CommandEmpty } from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { groupByBrand, scopeLabel } from "@/lib/scope";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-provider";

/** Brand ▸ Market ▸ Ad account, multi-select; nothing selected means all accounts. */
export function ScopeSwitcher() {
  const { accounts, selectedAccountIds, setSelectedAccountIds } = useShell();
  const label = scopeLabel(accounts, selectedAccountIds);

  function toggle(id: string) {
    setSelectedAccountIds(
      selectedAccountIds.includes(id) ? selectedAccountIds.filter((x) => x !== id) : [...selectedAccountIds, id],
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="ghost" className="min-w-0 max-w-[min(420px,50vw)] px-2 text-slate-12" aria-label={`Scope: ${label}`}>
          <Layers className="text-slate-11" />
          <span className="truncate">{label}</span>
          <ChevronsUpDown className="text-slate-11" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0">
        <Command>
          <CommandInput placeholder="Search brands, markets, accounts…" />
          <CommandList>
            <CommandGroup>
              <CommandItem value="all-accounts" onSelect={() => setSelectedAccountIds([])}>
                <Layers />
                All accounts
                <Check className={cn("ml-auto text-slate-12!", selectedAccountIds.length > 0 && "invisible")} />
              </CommandItem>
            </CommandGroup>
            {groupByBrand(accounts).map(([brand, list]) => (
              <CommandGroup key={brand} heading={brand}>
                {list.map((a) => (
                  <CommandItem key={a.id} value={`${a.brand} ${a.market} ${a.name} ${a.id}`} onSelect={() => toggle(a.id)}>
                    <span className="w-7 shrink-0 text-label font-medium text-slate-11">{a.market}</span>
                    <span className="truncate">{a.name}</span>
                    <Check className={cn("ml-auto text-slate-12!", !selectedAccountIds.includes(a.id) && "invisible")} />
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
            <CommandEmpty>No matching accounts.</CommandEmpty>
          </CommandList>
          {accounts.length === 0 && (
            <div className="border-t border-slate-6 px-3 py-3 text-ui text-slate-11">
              No ad accounts yet.{" "}
              <Link href="/settings" className="font-medium text-iris-11 hover:underline">
                Connect Meta
              </Link>{" "}
              to choose brands and markets.
            </div>
          )}
        </Command>
      </PopoverContent>
    </Popover>
  );
}
