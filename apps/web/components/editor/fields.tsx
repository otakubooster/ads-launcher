"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";
import { moneyInputValue, parseMoneyInput } from "@/lib/format";
import { cn } from "@/lib/utils";

/** A card section like Ads Manager's ("Budget & schedule", "Audience", …). */
export function Section({ title, description, children, id }: { title: string; description?: string; children: React.ReactNode; id?: string }) {
  return (
    <section id={id} aria-labelledby={id ? `${id}-title` : undefined} className="rounded-card border border-slate-6 bg-slate-1 dark:bg-slate-2">
      <header className="border-b border-slate-6 px-4 py-3">
        <h3 id={id ? `${id}-title` : undefined} className="text-body font-semibold">
          {title}
        </h3>
        {description && <p className="mt-0.5 text-ui text-slate-11">{description}</p>}
      </header>
      <div className="grid gap-4 px-4 py-4">{children}</div>
    </section>
  );
}

/** Money in the account currency; stores minor units. */
export function MoneyInput({ value, onChange, currency, id, className, ...rest }: { value: number | null | undefined; onChange: (minor: number) => void; currency: string; id: string; className?: string } & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  const [text, setText] = React.useState(moneyInputValue(value || null, currency));
  return (
    <div className={cn("relative", className)}>
      <Input
        id={id}
        inputMode="decimal"
        className="pr-12 text-right tabular-nums"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          onChange(parseMoneyInput(e.target.value, currency) ?? 0);
        }}
        {...rest}
      />
      <span className="pointer-events-none absolute top-1/2 right-2.5 -translate-y-1/2 text-label text-slate-11">{currency}</span>
    </div>
  );
}

/** datetime-local in the viewer's time zone, stored as ISO. */
export function DateTimeInput({ value, onChange, id, ...rest }: { value: string | null | undefined; onChange: (iso: string | null) => void; id: string } & Omit<React.ComponentProps<"input">, "value" | "onChange">) {
  const local = (() => {
    if (!value) return "";
    const d = new Date(value);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  return <Input id={id} type="datetime-local" value={local} onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)} {...rest} />;
}

/** Radio cards in one row (Ads Manager's "Daily budget / Lifetime budget"). */
export function Segmented<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" className="inline-flex h-8 rounded-control border border-slate-7 p-0.5">
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            "flex items-center justify-center rounded-[4px] px-3 text-ui has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-iris-8",
            value === o.value ? "bg-slate-4 font-medium" : "text-slate-11",
          )}
        >
          <input type="radio" name={name} className="sr-only" checked={value === o.value} onChange={() => onChange(o.value)} />
          {o.label}
        </label>
      ))}
    </div>
  );
}

/** Up to five variations of one text, like Ads Manager's "Add text option". */
export function TextOptions({ label, values, onChange, limit, multiline, max = 5 }: { label: string; values: string[]; onChange: (v: string[]) => void; limit: number; multiline?: boolean; max?: number }) {
  const list = values.length ? values : [""];
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-label font-medium text-slate-11">
        {label} <span className="font-normal">· up to {max}</span>
      </legend>
      {list.map((v, i) => {
        const set = (text: string) => onChange(list.map((x, j) => (j === i ? text : x)));
        const props = { "aria-label": `${label} ${i + 1}`, value: v, className: "w-full" };
        return (
          <div key={i} className="flex items-start gap-2">
            <div className="grid flex-1 gap-1">
              {multiline ? (
                <textarea {...props} rows={3} onChange={(e) => set(e.target.value)} className="min-h-20 w-full rounded-control border border-slate-7 bg-slate-1 px-2.5 py-2 text-ui leading-5 outline-none hover:border-slate-8 focus-visible:border-iris-8 focus-visible:outline-2 focus-visible:outline-iris-8 dark:bg-slate-2" />
              ) : (
                <Input {...props} onChange={(e) => set(e.target.value)} />
              )}
              <span className={cn("justify-self-end text-label tabular-nums", v.length > limit ? "text-amber-11" : "text-slate-11")}>
                {v.length}/{limit}
              </span>
            </div>
            {list.length > 1 && (
              <button type="button" aria-label={`Remove ${label.toLowerCase()} ${i + 1}`} onClick={() => onChange(list.filter((_, j) => j !== i))} className="mt-1 inline-flex size-7 items-center justify-center rounded-control text-slate-11 hover:bg-slate-3 hover:text-slate-12">
                ×
              </button>
            )}
          </div>
        );
      })}
      {list.length < max && (
        <button type="button" onClick={() => onChange([...list, ""])} className="justify-self-start rounded-control px-2 py-1 text-ui font-medium text-iris-11 hover:bg-iris-3">
          + Add {label.toLowerCase()} option
        </button>
      )}
    </fieldset>
  );
}
