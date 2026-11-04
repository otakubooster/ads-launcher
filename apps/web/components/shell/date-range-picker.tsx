"use client";

import * as React from "react";
import { CalendarDays, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DATE_PRESETS, MAX_LOOKBACK_DAYS, addDays, formatRange, previousPeriod, resolvePreset, todayIso, type DatePresetId, type DateRange } from "@/lib/date-range";
import { cn } from "@/lib/utils";
import { useShell } from "./shell-provider";

/**
 * Ads Manager's date picker: presets on the left, a custom start and end date on
 * the right (each opens the browser's calendar), compare, then Update.
 */
export function DateRangePicker() {
  const { datePreset, setDatePreset, customRange, setCustomRange, compare, setCompare } = useShell();
  // Until accounts exist, "today" is the browser's; later it is the ad account's time zone.
  const today = React.useMemo(() => todayIso(), []);
  const applied: DateRange = datePreset === "custom" && customRange ? customRange : resolvePreset(datePreset === "custom" ? "last_7d" : datePreset, today);
  const label = datePreset === "custom" ? "Custom" : DATE_PRESETS.find((p) => p.id === datePreset)?.label;

  const [open, setOpen] = React.useState(false);
  // Draft while the picker is open; nothing changes until Update.
  const [preset, setPreset] = React.useState<DatePresetId | "custom">(datePreset);
  const [since, setSince] = React.useState(applied.since);
  const [until, setUntil] = React.useState(applied.until);
  const [cmp, setCmp] = React.useState(compare);
  const minDate = addDays(today, -MAX_LOOKBACK_DAYS);
  const valid = since && until && since <= until && since >= minDate && until <= today;

  const onOpenChange = (o: boolean) => {
    if (o) {
      setPreset(datePreset);
      setSince(applied.since);
      setUntil(applied.until);
      setCmp(compare);
    }
    setOpen(o);
  };

  const pick = (id: DatePresetId) => {
    const r = resolvePreset(id, today);
    setPreset(id);
    setSince(r.since);
    setUntil(r.until);
  };

  const update = () => {
    if (!valid) return;
    if (preset !== "custom") setDatePreset(preset);
    else setCustomRange({ since, until });
    if (cmp !== compare) setCompare(cmp);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button aria-label={`Date range: ${label}, ${formatRange(applied, today)}`}>
          <CalendarDays className="text-slate-11" />
          <span>{label}</span>
          <span className={cn("text-slate-11 tabular-nums", datePreset === "custom" ? "inline" : "hidden lg:inline")}>{formatRange(applied, today)}</span>
          {compare && <span className="hidden rounded-xs bg-slate-4 px-1 text-label text-slate-11 xl:inline">vs prev</span>}
          <ChevronDown className="text-slate-11" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(560px,calc(100vw-32px))] p-0">
        <div className="grid sm:grid-cols-[180px_minmax(0,1fr)]">
          <div role="radiogroup" aria-label="Date presets" className="grid content-start gap-0.5 border-b border-slate-6 p-2 sm:border-r sm:border-b-0">
            {DATE_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={preset === p.id}
                onClick={() => pick(p.id)}
                className={cn("flex h-8 items-center rounded-control px-2 text-left text-ui", preset === p.id ? "bg-iris-3 font-medium text-iris-11" : "text-slate-12 hover:bg-slate-3")}
              >
                {p.label}
              </button>
            ))}
            <button
              type="button"
              role="radio"
              aria-checked={preset === "custom"}
              onClick={() => setPreset("custom")}
              className={cn("flex h-8 items-center rounded-control px-2 text-left text-ui", preset === "custom" ? "bg-iris-3 font-medium text-iris-11" : "text-slate-12 hover:bg-slate-3")}
            >
              Custom
            </button>
          </div>
          <div className="grid content-start gap-4 p-4">
            <div className="grid grid-cols-2 gap-3">
              <label className="grid gap-1 text-label font-medium text-slate-11">
                Start date
                <Input
                  type="date"
                  value={since}
                  min={minDate}
                  max={until || today}
                  onChange={(e) => {
                    setPreset("custom");
                    setSince(e.target.value);
                  }}
                />
              </label>
              <label className="grid gap-1 text-label font-medium text-slate-11">
                End date
                <Input
                  type="date"
                  value={until}
                  min={since || minDate}
                  max={today}
                  onChange={(e) => {
                    setPreset("custom");
                    setUntil(e.target.value);
                  }}
                />
              </label>
            </div>
            <p className="text-ui text-slate-11 tabular-nums" aria-live="polite">
              {valid ? formatRange({ since, until }, today) : since > until ? "The start date is after the end date." : "Choose dates within the last 37 months."}
            </p>
            <label className="flex items-center gap-2 text-ui">
              <Checkbox checked={cmp} onChange={(e) => setCmp(e.currentTarget.checked)} />
              Compare to previous period
              {cmp && valid && <span className="text-slate-11 tabular-nums">({formatRange(previousPeriod({ since, until }), today)})</span>}
            </label>
            <div className="flex justify-end gap-2 border-t border-slate-6 pt-3">
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!valid} onClick={update}>
                Update
              </Button>
            </div>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
