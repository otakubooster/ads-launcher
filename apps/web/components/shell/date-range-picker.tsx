"use client";

import { useMemo } from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DATE_PRESETS, formatRange, previousPeriod, resolvePreset, todayIso, type DatePresetId } from "@/lib/date-range";
import { useShell } from "./shell-provider";

export function DateRangePicker() {
  const { datePreset, setDatePreset, compare, setCompare } = useShell();
  // Until accounts exist, "today" is the browser's; later it is the ad account's time zone.
  const today = useMemo(() => todayIso(), []);
  const range = resolvePreset(datePreset, today);
  const label = DATE_PRESETS.find((p) => p.id === datePreset)?.label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label={`Date range: ${label}`}>
          <CalendarDays className="text-slate-11" />
          <span>{label}</span>
          <span className="hidden text-slate-11 tabular-nums lg:inline">{formatRange(range, today)}</span>
          {compare && (
            <span className="hidden rounded-xs bg-slate-4 px-1 text-label text-slate-11 xl:inline">vs prev</span>
          )}
          <ChevronDown className="text-slate-11" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-auto min-w-72">
        <DropdownMenuLabel>Date range</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={datePreset} onValueChange={(v) => setDatePreset(v as DatePresetId)}>
          {DATE_PRESETS.map((p) => (
            <DropdownMenuRadioItem key={p.id} value={p.id}>
              {p.label}
              <DropdownMenuShortcut>{formatRange(resolvePreset(p.id, today), today)}</DropdownMenuShortcut>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked={compare} onCheckedChange={setCompare} onSelect={(e) => e.preventDefault()}>
          <span className="whitespace-nowrap">Compare to previous period</span>
          {compare && <DropdownMenuShortcut>{formatRange(previousPeriod(range), today)}</DropdownMenuShortcut>}
        </DropdownMenuCheckboxItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
