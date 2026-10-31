"use client";

import * as React from "react";
import { flexRender, type Row, type Table } from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, Copy, CopyPlus, ExternalLink, PanelRightOpen, Pencil } from "lucide-react";
import { toast } from "sonner";
import { StatusDot } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { RowSwitch } from "@/components/ui/switch";
import { EMPTY, formatMoney, formatNumber, formatPercent, formatRoas } from "@/lib/format";
import { ratios, sumCounts } from "@/lib/metrics";
import { cn } from "@/lib/utils";
import { COLUMNS, type ColumnId, type TableRow } from "./columns";

export const ROW_HEIGHT = { comfortable: 40, compact: 32 } as const;
const HEADER_HEIGHT = 36;
export const STICKY_WIDTHS = { select: 76, name: 300 } as const;

type Props = {
  table: Table<TableRow>;
  density: keyof typeof ROW_HEIGHT;
  canEdit: boolean;
  activeId: string | null;
  onActivate: (id: string) => void;
  onToggle: (row: TableRow, on: boolean) => void;
  onOpen: (row: TableRow) => void;
  /** Clicking a campaign or ad set name opens its children, like Ads Manager. Ads open details. */
  onDrill?: (row: TableRow) => void;
  onBudget: (row: TableRow, anchor: HTMLElement) => void;
  onSelectRange: (toId: string) => boolean;
  /** Ads Manager's Duplicate for one row; omitted for viewers. */
  onDuplicate?: (row: TableRow) => void;
  /** Ads Manager's Edit for one row; omitted for viewers. */
  onEdit?: (row: TableRow) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
  totalReach?: number | null;
};

function adsManagerUrl(r: TableRow) {
  const tab = r.level === "campaign" ? "campaigns" : r.level === "adset" ? "adsets" : "ads";
  return `https://adsmanager.facebook.com/adsmanager/manage/${tab}?selected_${r.level}_ids=${r.metaId}`;
}

export function AdsTable({ table, density, canEdit, activeId, onActivate, onToggle, onOpen, onBudget, onSelectRange, onDuplicate, onEdit, onDrill, scrollRef, totalReach = null }: Props) {
  const rows = table.getRowModel().rows;
  const rowHeight = ROW_HEIGHT[density];

  // The virtualizer is read during render only; React Compiler skips this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (i) => rows[i]!.id,
  });
  React.useEffect(() => virtualizer.measure(), [rowHeight, virtualizer]);

  const items = virtualizer.getVirtualItems();
  const padTop = items[0]?.start ?? 0;
  const padBottom = virtualizer.getTotalSize() - (items.at(-1)?.end ?? 0);

  const visible = table.getVisibleLeafColumns();
  const totals = React.useMemo(() => {
    const data = rows.map((r) => r.original);
    const counts = sumCounts(data);
    const currencies = new Set(data.map((r) => r.currency));
    // Account reach only describes the whole view; a filtered subset has no total reach.
    const reach = rows.length === table.getCoreRowModel().rows.length ? totalReach : null;
    return { counts, ratios: ratios(counts), currency: currencies.size === 1 ? [...currencies][0]! : null, n: data.length, reach };
  }, [rows, table, totalReach]);

  const columnKey = visible.map((c) => `${c.id}:${c.getSize()}`).join(",");

  return (
    <div
      ref={scrollRef}
      onScroll={(e) => {
        // A DOM attribute, not state, so horizontal scrolling never re-renders rows.
        const scrolled = String(e.currentTarget.scrollLeft > 0);
        if (e.currentTarget.dataset.scrolled !== scrolled) e.currentTarget.dataset.scrolled = scrolled;
      }}
      className="relative min-h-0 flex-1 overflow-auto rounded-card border border-slate-6"
      role="region"
      aria-label="Ads table"
    >
      <table className="w-max min-w-full table-fixed border-separate border-spacing-0 text-ui">
        <colgroup>
          {visible.map((c) => (
            <col key={c.id} style={{ width: c.getSize() }} />
          ))}
        </colgroup>
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id}>
              {group.headers.map((h) => {
                const def = COLUMNS[h.column.id as ColumnId];
                const sorted = h.column.getIsSorted();
                return (
                  <th
                    key={h.id}
                    scope="col"
                    style={{ height: HEADER_HEIGHT, ...stickyLeft(h.column.id) }}
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={cn(
                      "sticky top-0 z-[1] border-b border-slate-6 bg-slate-2 px-3 text-label font-medium whitespace-nowrap text-slate-11 select-none",
                      def?.align === "right" ? "text-right" : "text-left",
                      stickyCell(h.column.id),
                      (h.column.id === "select" || h.column.id === "name") && "z-[3]",
                    )}
                  >
                    {h.column.getCanSort() ? (
                      <button
                        type="button"
                        onClick={h.column.getToggleSortingHandler()}
                        className={cn("inline-flex items-center gap-1 hover:text-slate-12", def?.align === "right" && "flex-row-reverse")}
                      >
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                    {h.column.getCanResize() && (
                      <span
                        role="separator"
                        aria-orientation="vertical"
                        aria-label={`Resize ${h.column.id}`}
                        onMouseDown={h.getResizeHandler()}
                        onTouchStart={h.getResizeHandler()}
                        className={cn("absolute top-1.5 right-0 bottom-1.5 w-1 cursor-col-resize rounded-full hover:bg-iris-8", h.column.getIsResizing() && "bg-iris-9")}
                      />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr aria-hidden>
              <td style={{ height: padTop }} colSpan={visible.length} />
            </tr>
          )}
          {items.map((vi) => {
            const row = rows[vi.index]!;
            return (
              <BodyRow
                key={row.id}
                row={row}
                columnKey={columnKey}
                selected={row.getIsSelected()}
                active={row.id === activeId}
                rowHeight={rowHeight}
                canEdit={canEdit}
                onActivate={onActivate}
                onToggle={onToggle}
                onOpen={onOpen}
                onDrill={onDrill}
                onBudget={onBudget}
                onSelectRange={onSelectRange}
                onDuplicate={onDuplicate}
                onEdit={onEdit}
              />
            );
          })}
          {padBottom > 0 && (
            <tr aria-hidden>
              <td style={{ height: padBottom }} colSpan={visible.length} />
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr style={{ height: rowHeight }}>
            {visible.map((c) => {
              const id = c.id as ColumnId | "select" | "name";
              const cls = cn(
                "sticky bottom-0 z-[1] border-t border-slate-6 bg-slate-2 px-3 font-medium whitespace-nowrap tabular-nums",
                COLUMNS[id as ColumnId]?.align === "right" && "text-right",
                stickyCell(id),
                (id === "select" || id === "name") && "z-[3]",
              );
              return (
                <td key={c.id} className={cls} style={stickyLeft(id)}>
                  {id === "name" ? `Total · ${formatNumber(totals.n)} ${totals.n === 1 ? "row" : "rows"}` : totalCell(id, totals)}
                </td>
              );
            })}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function totalCell(id: string, t: { counts: ReturnType<typeof sumCounts>; ratios: ReturnType<typeof ratios>; currency: string | null; reach: number | null }) {
  const money = (v: number | null) => (v === null ? EMPTY : t.currency ? formatMoney(Math.round(v), t.currency) : "Mixed");
  switch (id) {
    case "spend":
      return money(t.counts.spend);
    case "purchaseValue":
      return money(t.counts.purchaseValue);
    case "cpa":
      return money(t.ratios.cpa);
    case "cpm":
      return money(t.ratios.cpm);
    case "impressions":
      return formatNumber(t.counts.impressions);
    case "clicks":
      return formatNumber(t.counts.clicks);
    case "purchases":
      return formatNumber(t.counts.purchases);
    case "roas":
      return t.currency ? formatRoas(t.ratios.roas) : EMPTY;
    case "ctr":
      return formatPercent(t.ratios.ctr);
    case "hookRate":
      return formatPercent(t.ratios.hookRate);
    case "holdRate":
      return formatPercent(t.ratios.holdRate);
    case "results":
      return formatNumber(t.counts.results);
    case "costPerResult":
      return money(t.ratios.costPerResult);
    case "cpc":
      return money(t.ratios.cpc);
    case "addToCart":
      return formatNumber(t.counts.addToCart);
    case "checkouts":
      return formatNumber(t.counts.checkouts);
    case "reach":
      return t.reach === null ? EMPTY : formatNumber(t.reach);
    case "frequency":
      return t.reach ? (t.counts.impressions / t.reach).toFixed(2) : EMPTY;
    default:
      return "";
  }
}

function RowAction({ label, icon: Icon, onClick }: { label: string; icon: typeof Copy; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => (e.stopPropagation(), onClick())}
      className="inline-flex size-6 items-center justify-center rounded-xs text-slate-11 hover:bg-slate-5 hover:text-slate-12"
    >
      <Icon className="size-3.5" />
    </button>
  );
}

const stickyCell = (id: string) =>
  id === "select"
    ? "sticky left-0 z-[2]"
    : id === "name"
      ? "sticky z-[2] after:pointer-events-none after:absolute after:inset-y-0 after:-right-3 after:w-3 after:opacity-0 after:transition-opacity in-data-[scrolled=true]:after:opacity-100 after:bg-gradient-to-r after:from-black/[0.06] after:to-transparent dark:after:from-black/40"
      : "";
const stickyLeft = (id: string) => (id === "name" ? { left: STICKY_WIDTHS.select } : undefined);

type BodyRowProps = {
  row: Row<TableRow>;
  /** Changes when columns or widths change, so memoized rows re-render then. */
  columnKey: string;
  selected: boolean;
  active: boolean;
  rowHeight: number;
} & Pick<Props, "canEdit" | "onActivate" | "onToggle" | "onOpen" | "onBudget" | "onSelectRange" | "onDuplicate" | "onEdit" | "onDrill">;

/** Memoized so scrolling only renders rows entering the viewport. */
const BodyRow = React.memo(function BodyRow({ row, selected, active, rowHeight, canEdit, onActivate, onToggle, onOpen, onBudget, onSelectRange, onDuplicate, onEdit, onDrill }: BodyRowProps) {
  const r = row.original;
  return (
    <tr
      data-row-id={r.id}
      aria-selected={selected}
      onClick={() => onActivate(r.id)}
      onDoubleClick={() => onOpen(r)}
      className={cn("group/row", selected ? "bg-iris-3" : "hover:bg-slate-3", active && "outline-2 -outline-offset-2 outline-iris-8")}
      style={{ height: rowHeight }}
    >
      {row.getVisibleCells().map((cell) => {
        const id = cell.column.id;
        const def = COLUMNS[id as ColumnId];
        const base = cn(
          "border-b border-slate-6 px-3 whitespace-nowrap",
          def?.align === "right" && "text-right tabular-nums",
          (id === "select" || id === "name") && (selected ? "bg-iris-3" : "bg-slate-1 group-hover/row:bg-slate-3 dark:bg-slate-1"),
          stickyCell(id),
        );
        if (id === "select") {
          return (
            <td key={cell.id} className={base}>
              <div className="flex items-center gap-2.5">
                <Checkbox
                  aria-label={`Select ${r.name}`}
                  checked={selected}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (e.shiftKey && onSelectRange(r.id)) e.preventDefault();
                  }}
                  onChange={row.getToggleSelectedHandler()}
                />
                <RowSwitch
                  checked={r.status === "ACTIVE"}
                  disabled={!canEdit || r.status === "DELETED"}
                  aria-label={`${r.status === "ACTIVE" ? "Pause" : "Activate"} ${r.name}`}
                  onCheckedChange={(on) => onToggle(r, on)}
                />
              </div>
            </td>
          );
        }
        if (id === "name") {
          return (
            <td key={cell.id} className={base} style={stickyLeft(id)}>
              <div className="flex min-w-0 items-center gap-2">
                {r.level === "ad" &&
                  (r.thumbnailUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={r.thumbnailUrl} alt="" className="size-6 shrink-0 rounded-xs bg-slate-3 object-cover" loading="lazy" />
                  ) : (
                    <span className="size-6 shrink-0 rounded-xs bg-slate-3" />
                  ))}
                <button
                  type="button"
                  title={onDrill && r.level !== "ad" ? `Show ${r.level === "campaign" ? "ad sets" : "ads"} in ${r.name}` : undefined}
                  onClick={(e) => (e.stopPropagation(), onDrill && r.level !== "ad" ? onDrill(r) : onOpen(r))}
                  className="min-w-0 truncate text-left font-medium hover:underline"
                >
                  {r.name}
                </button>
                <span className="ml-auto hidden shrink-0 items-center gap-0.5 group-hover/row:flex group-focus-within/row:flex">
                  <RowAction label="Open details" onClick={() => onOpen(r)} icon={PanelRightOpen} />
                  {onEdit && r.status !== "DELETED" && <RowAction label="Edit" onClick={() => onEdit(r)} icon={Pencil} />}
                  {onDuplicate && r.status !== "DELETED" && <RowAction label="Duplicate" onClick={() => onDuplicate(r)} icon={CopyPlus} />}
                  <RowAction
                    label="Copy Meta ID"
                    icon={Copy}
                    onClick={() => {
                      void navigator.clipboard?.writeText(r.metaId);
                      toast("Copied", { description: r.metaId });
                    }}
                  />
                  <RowAction label="Open in Ads Manager" icon={ExternalLink} onClick={() => window.open(adsManagerUrl(r), "_blank", "noopener")} />
                </span>
              </div>
            </td>
          );
        }
        if (id === "delivery") {
          return (
            <td key={cell.id} className={base}>
              <StatusDot tone={r.delivery.tone} label={r.delivery.label} />
            </td>
          );
        }
        if (id === "budget") {
          const editable = canEdit && r.level !== "ad" && r.budgetFrom === null && r.dailyBudget !== null;
          const text = def!.format(r);
          return (
            <td key={cell.id} className={cn(base, r.budgetFrom && "text-slate-11")}>
              {editable ? (
                <button
                  type="button"
                  onClick={(e) => (e.stopPropagation(), onBudget(r, e.currentTarget))}
                  className="-mx-1 rounded-xs px-1 underline decoration-slate-8 decoration-dotted underline-offset-4 hover:bg-slate-4"
                  aria-label={`Edit budget for ${r.name}: ${text}`}
                >
                  {text}
                </button>
              ) : (
                text
              )}
            </td>
          );
        }
        const sub = def?.sub?.(r);
        return (
          <td key={cell.id} className={cn(base, (id === "account" || id === "parent") && "max-w-0 truncate text-slate-11")}>
            {sub ? (
              <span className="flex flex-col leading-4">
                <span>{def!.format(r)}</span>
                <span className="truncate text-label text-slate-11">{sub}</span>
              </span>
            ) : def ? (
              def.format(r)
            ) : (
              flexRender(cell.column.columnDef.cell, cell.getContext())
            )}
          </td>
        );
      })}
    </tr>
  );
});
