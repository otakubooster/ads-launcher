"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type RowSelectionState,
  type SortingState,
  type Table as TanstackTable,
  type VisibilityState,
} from "@tanstack/react-table";
import { Bookmark, ChevronDown, Columns3, CopyPlus, Download, Pause, Pencil, Play, Plus, Rows3, Search, Table2, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { adjustBudgetsAction, deleteViewAction, saveViewAction, setBudgetAction, setStatusAction } from "@/app/(app)/ads/actions";
import { EmptyState } from "@/components/empty-state";
import { StatusDot } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import type { DateRange } from "@/lib/date-range";
import { LAUNCH_FEATURES } from "@/lib/features";
import { formatMoney, formatRoas, moneyInputValue, parseMoneyInput } from "@/lib/format";
import type { ActionResult } from "@/lib/server/action-result";
import type { AccountBudgets, AdsRow, Level } from "@/lib/server/ads";
import { cn } from "@/lib/utils";
import { useShell } from "@/components/shell/shell-provider";
import { AdsTable, STICKY_WIDTHS, ROW_HEIGHT } from "./ads-table";
import { DuplicateDialog } from "./duplicate-dialog";
import { EditDialog } from "./edit-dialog";
import { ALL_COLUMNS, COLUMNS, PRESETS, PRESET_LABELS, toCsv, toTableRows, type ColumnId, type PresetId, type TableRow } from "./columns";
import { DetailDrawer } from "./detail-drawer";

export type SavedView = { id: string; name: string; columns: string[]; filters: Record<string, unknown>; sort: { id: string; desc: boolean }[] };

const LEVELS: { level: Level; param: string; label: string }[] = [
  { level: "campaign", param: "campaigns", label: "Campaigns" },
  { level: "adset", param: "adsets", label: "Ad sets" },
  { level: "ad", param: "ads", label: "Ads" },
];

const STATUS_FILTERS = {
  all: { label: "All", match: () => true },
  active: { label: "Active", match: (r: TableRow) => r.status === "ACTIVE" },
  paused: { label: "Paused", match: (r: TableRow) => r.status !== "ACTIVE" },
  issues: { label: "Issues", match: (r: TableRow) => r.delivery.tone === "negative" || r.delivery.tone === "warning" },
} as const;
type StatusFilter = keyof typeof STATUS_FILTERS;

type Props = {
  level: Level;
  rows: AdsRow[];
  /** Unique people across the accounts in view, from Meta; null when unknown. */
  totalReach?: number | null;
  budgets: AccountBudgets;
  views: SavedView[];
  canEdit: boolean;
  range: DateRange;
  parentSelection: { campaignIds: string[]; adsetIds: string[] };
  hasAccounts: boolean;
  /** Opens this row's drawer on load (links from the dashboard). */
  initialOpenId?: string;
};

export function AdsView({ level, rows: initialRows, totalReach = null, budgets, views, canEdit, range, parentSelection, hasAccounts, initialOpenId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Optimistic status changes until the server refresh lands.
  const [statusOverride, setStatusOverride] = React.useState<Record<string, string>>({});
  const data = React.useMemo(
    () => toTableRows(initialRows.map((r) => (statusOverride[r.id] ? { ...r, status: statusOverride[r.id]!, effectiveStatus: statusOverride[r.id]! } : r))),
    [initialRows, statusOverride],
  );

  const [search, setSearch] = React.useState("");
  const [statusFilter, setStatusFilter] = React.useState<StatusFilter>("all");
  const [preset, setPreset] = React.useState<PresetId>("adsManager");
  const [columns, setColumns] = React.useState<ColumnId[]>(PRESETS.adsManager);
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const [density, setDensity] = React.useState<keyof typeof ROW_HEIGHT>("comfortable");
  const ownSelection = level === "campaign" ? parentSelection.campaignIds : level === "adset" ? parentSelection.adsetIds : [];
  const [rowSelection, setRowSelection] = React.useState<RowSelectionState>(() => Object.fromEntries(ownSelection.map((id) => [id, true])));
  const [activeId, setActiveId] = React.useState<string | null>(null);
  const [drawerId, setDrawerId] = React.useState<string | null>(initialOpenId ?? null);
  const [confirm, setConfirm] = React.useState<TableRow[] | null>(null);
  const [budgetEdit, setBudgetEdit] = React.useState<{ row: TableRow; rect: DOMRect } | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [duplicateRows, setDuplicateRows] = React.useState<TableRow[] | null>(null);
  // Stable for the memoized rows.
  const onDuplicateRow = React.useCallback((r: TableRow) => setDuplicateRows([r]), []);
  const [editRow, setEditRow] = React.useState<TableRow | null>(null);
  const onEditRow = React.useCallback((r: TableRow) => setEditRow(r), []);
  const [busy, startBusy] = React.useTransition();
  const lastClicked = React.useRef<string | null>(null);
  const scrollRef = React.useRef<HTMLDivElement | null>(null);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    return data.filter((r) => STATUS_FILTERS[statusFilter].match(r) && (!q || r.name.toLowerCase().includes(q) || r.metaId.includes(q)));
  }, [data, search, statusFilter]);

  const columnDefs = React.useMemo<ColumnDef<TableRow>[]>(
    () => [
      { id: "select", header: ({ table: t }) => <SelectAll table={t} />, size: STICKY_WIDTHS.select, enableSorting: false, enableResizing: false },
      { id: "name", header: LEVELS.find((l) => l.level === level)!.label.replace(/s$/, ""), accessorFn: (r) => r.name, size: STICKY_WIDTHS.name, minSize: 180 },
      ...ALL_COLUMNS.map<ColumnDef<TableRow>>((id) => ({
        id,
        header: COLUMNS[id].label,
        accessorFn: (r) => COLUMNS[id].value(r) ?? -Infinity,
        size: COLUMNS[id].width,
        minSize: 72,
        sortDescFirst: COLUMNS[id].align === "right",
      })),
    ],
    [level],
  );

  const columnVisibility = React.useMemo<VisibilityState>(() => Object.fromEntries(ALL_COLUMNS.map((c) => [c, columns.includes(c)])), [columns]);
  const columnOrder = React.useMemo(() => ["select", "name", ...columns, ...ALL_COLUMNS.filter((c) => !columns.includes(c))], [columns]);

  // TanStack Table returns new functions each render; React Compiler skips this component.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({
    data: filtered,
    columns: columnDefs,
    state: { sorting, rowSelection, columnVisibility, columnOrder },
    getRowId: (r) => r.id,
    onSortingChange: setSorting,
    onRowSelectionChange: setRowSelection,
    enableRowSelection: true,
    columnResizeMode: "onChange",
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  const selectedRows = table.getSelectedRowModel().rows.map((r) => r.original);
  const selectedIds = selectedRows.map((r) => r.id);

  // Selecting campaigns or ad sets filters the next level, via the URL.
  const ownParam = level === "campaign" ? "campaigns" : level === "adset" ? "adsets" : null;
  const selectionKey = selectedIds.slice().sort().join(",");
  React.useEffect(() => {
    if (!ownParam) return;
    const current = searchParams.get(ownParam) ?? "";
    if (current === selectionKey) return;
    const next = new URLSearchParams(searchParams);
    if (selectionKey) next.set(ownParam, selectionKey);
    else next.delete(ownParam);
    if (ownParam === "campaigns") next.delete("adsets");
    router.replace(`${pathname}?${next}`, { scroll: false });
  }, [ownParam, selectionKey, searchParams, router, pathname]);

  const tabHref = (param: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("level", param);
    return `${pathname}?${next}`;
  };

  const selectRange = (toId: string) => {
    const from = lastClicked.current;
    lastClicked.current = toId;
    if (!from || from === toId) return false;
    const ids = table.getRowModel().rows.map((r) => r.id);
    const [a, b] = [ids.indexOf(from), ids.indexOf(toId)].sort((x, y) => x - y);
    if (a! < 0) return false;
    setRowSelection((prev) => ({ ...prev, ...Object.fromEntries(ids.slice(a, b! + 1).map((id) => [id, true])) }));
    return true;
  };

  // --- Writes ----------------------------------------------------------------

  function report(res: ActionResult<unknown>) {
    if (res.ok) toast.success(res.message ?? "Done");
    else toast.error(res.error.title, { description: [res.error.detail, res.error.fix].filter(Boolean).join(" ") });
  }

  function setStatus(targets: TableRow[], status: "ACTIVE" | "PAUSED", { undoable = true } = {}) {
    const prev = Object.fromEntries(targets.map((r) => [r.id, r.status]));
    setStatusOverride((o) => ({ ...o, ...Object.fromEntries(targets.map((r) => [r.id, status])) }));
    startBusy(async () => {
      const res = await setStatusAction(level, targets.map((r) => r.id), status);
      if (!res.ok) {
        setStatusOverride((o) => ({ ...o, ...prev }));
        report(res);
        return;
      }
      router.refresh();
      if (status === "PAUSED" && undoable) {
        toast.success(targets.length === 1 ? `Paused ${targets[0]!.name}` : `Paused ${targets.length} items`, {
          duration: 6_000,
          action: { label: "Undo", onClick: () => setStatus(targets, "ACTIVE", { undoable: false }) },
        });
      } else report(res);
    });
  }

  const onToggle = (row: TableRow, on: boolean) => (on ? setConfirm([row]) : setStatus([row], "PAUSED"));

  function adjustBudgets(pct: number) {
    const targets = selectedRows.filter((r) => r.budgetFrom === null && r.dailyBudget !== null);
    if (targets.length === 0) return toast("Nothing to change", { description: "None of the selected rows has its own daily budget." });
    startBusy(async () => {
      report(await adjustBudgetsAction(level, targets.map((r) => r.id), pct, Object.fromEntries(targets.map((r) => [r.id, r.dailyBudget!]))));
      router.refresh();
    });
  }

  function exportCsv() {
    const csv = toCsv(table.getRowModel().rows.map((r) => r.original), columns);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `${level}s-${range.since}-${range.until}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  function applyView(v: SavedView) {
    const cols = v.columns.filter((c): c is ColumnId => (ALL_COLUMNS as string[]).includes(c));
    setColumns(cols.length ? cols : PRESETS.adsManager);
    setPreset((v.filters.preset as PresetId) ?? "custom");
    setStatusFilter((v.filters.status as StatusFilter) ?? "all");
    setSearch(String(v.filters.search ?? ""));
    if (v.filters.density === "compact" || v.filters.density === "comfortable") setDensity(v.filters.density);
    setSorting(v.sort);
    toast(`View "${v.name}"`);
  }

  // --- Keyboard: J/K move, X selects, Enter opens -----------------------------

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target as HTMLElement;
      if (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) || document.querySelector('[role="dialog"],[role="menu"]')) return;
      const ids = table.getRowModel().rows.map((r) => r.id);
      if (!ids.length) return;
      const i = activeId ? ids.indexOf(activeId) : -1;
      const key = e.key.toLowerCase();
      if (key === "j" || key === "k") {
        e.preventDefault();
        const next = Math.min(ids.length - 1, Math.max(0, i + (key === "j" ? 1 : -1)));
        setActiveId(ids[next]!);
        scrollRef.current?.querySelector(`[data-row-id="${ids[next]}"]`)?.scrollIntoView({ block: "nearest" });
      } else if (key === "x" && activeId) {
        e.preventDefault();
        setRowSelection((s) => ({ ...s, [activeId]: !s[activeId] }));
      } else if (e.key === "Enter" && activeId) {
        setDrawerId(activeId);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [table, activeId]);

  const drawerRow = data.find((r) => r.id === drawerId) ?? null;
  const parentChip =
    level === "adset" && parentSelection.campaignIds.length
      ? { n: parentSelection.campaignIds.length, what: "campaign", clear: ["campaigns", "adsets"] }
      : level === "ad" && (parentSelection.adsetIds.length || parentSelection.campaignIds.length)
        ? parentSelection.adsetIds.length
          ? { n: parentSelection.adsetIds.length, what: "ad set", clear: ["adsets"] }
          : { n: parentSelection.campaignIds.length, what: "campaign", clear: ["campaigns"] }
        : null;

  return (
    <div className="flex h-[calc(100dvh-56px-48px)] min-h-[480px] flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Level" className="flex items-center gap-1 border-b border-slate-6">
          {LEVELS.map((l) => (
            <Link
              key={l.level}
              href={tabHref(l.param)}
              aria-current={l.level === level ? "page" : undefined}
              className="-mb-px inline-flex h-9 items-center border-b-2 border-transparent px-2.5 text-ui font-medium text-slate-11 hover:text-slate-12 aria-[current=page]:border-iris-9 aria-[current=page]:text-slate-12"
            >
              {l.label}
              {l.level === "campaign" && parentSelection.campaignIds.length > 0 && <SelectedCount n={parentSelection.campaignIds.length} />}
              {l.level === "adset" && parentSelection.adsetIds.length > 0 && <SelectedCount n={parentSelection.adsetIds.length} />}
            </Link>
          ))}
        </nav>
        {parentChip && (
          <span className="inline-flex h-7 items-center gap-1 rounded-full border border-iris-6 bg-iris-2 pr-1 pl-2.5 text-ui text-iris-11">
            {parentChip.n} {parentChip.what}
            {parentChip.n === 1 ? "" : "s"} selected
            <button
              type="button"
              aria-label="Clear selection"
              className="inline-flex size-5 items-center justify-center rounded-full hover:bg-iris-4"
              onClick={() => {
                const next = new URLSearchParams(searchParams);
                parentChip.clear.forEach((k) => next.delete(k));
                router.replace(`${pathname}?${next}`, { scroll: false });
              }}
            >
              <X className="size-3" />
            </button>
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {canEdit && LAUNCH_FEATURES && (
          <Button variant="primary" asChild>
            <Link href="/launch">
              <Plus />
              Create
            </Link>
          </Button>
        )}
        <div className="relative w-64 max-w-full">
          <Search className="pointer-events-none absolute top-2 left-2.5 size-4 text-slate-11" />
          <Input data-filter-input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by name or ID" aria-label="Search" className="pl-8" />
          <Kbd className="pointer-events-none absolute top-1.5 right-1.5">/</Kbd>
        </div>
        <div role="group" aria-label="Status" className="flex items-center gap-1">
          {(Object.keys(STATUS_FILTERS) as StatusFilter[]).map((k) => (
            <Button key={k} size="sm" variant={statusFilter === k ? "secondary" : "ghost"} aria-pressed={statusFilter === k} onClick={() => setStatusFilter(k)}>
              {STATUS_FILTERS[k].label}
            </Button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                <Columns3 className="text-slate-11" />
                {PRESET_LABELS[preset]}
                <ChevronDown className="text-slate-11" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel>Column preset</DropdownMenuLabel>
              <DropdownMenuRadioGroup
                value={preset}
                onValueChange={(v) => {
                  setPreset(v as PresetId);
                  if (v !== "custom") setColumns(PRESETS[v as keyof typeof PRESETS]);
                }}
              >
                {(["adsManager", "performance", "creative", "delivery"] as const).map((p) => (
                  <DropdownMenuRadioItem key={p} value={p}>
                    {PRESET_LABELS[p]}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Columns</DropdownMenuLabel>
              {ALL_COLUMNS.map((c) => (
                <DropdownMenuCheckboxItem
                  key={c}
                  checked={columns.includes(c)}
                  onSelect={(e) => e.preventDefault()}
                  onCheckedChange={(on) => {
                    setPreset("custom");
                    setColumns((cols) => (on ? [...cols, c] : cols.filter((x) => x !== c)));
                  }}
                >
                  {COLUMNS[c].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button aria-label="Saved views">
                <Bookmark className="text-slate-11" />
                Views
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {views.length === 0 && <DropdownMenuLabel className="font-normal">No saved views yet.</DropdownMenuLabel>}
              {views.map((v) => (
                <DropdownMenuItem key={v.id} onSelect={() => applyView(v)} className="pr-1">
                  <span className="truncate">{v.name}</span>
                  <button
                    type="button"
                    aria-label={`Delete view ${v.name}`}
                    className="ml-auto inline-flex size-6 items-center justify-center rounded-xs hover:bg-slate-5"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.preventDefault();
                      startBusy(async () => report(await deleteViewAction(v.id)));
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setSaveOpen(true)}>Save current view…</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            size="icon"
            variant="ghost"
            aria-label={density === "compact" ? "Comfortable rows" : "Compact rows"}
            aria-pressed={density === "compact"}
            onClick={() => setDensity((d) => (d === "compact" ? "comfortable" : "compact"))}
          >
            <Rows3 />
          </Button>
          <Button size="icon" variant="ghost" aria-label="Export CSV" onClick={exportCsv}>
            <Download />
          </Button>
        </div>
      </div>

      {initialRows.length === 0 ? (
        <EmptyState
          className="flex-1"
          icon={Table2}
          title={hasAccounts ? "Nothing here yet" : "No campaigns synced"}
          description={
            hasAccounts
              ? parentChip
                ? "Nothing matches the current selection. Clear it to see everything."
                : "Campaigns, ad sets and ads appear after the next sync with Meta."
              : "Campaigns, ad sets and ads appear here after the first sync with Meta."
          }
          action={
            !hasAccounts && (
              <Button variant="primary" asChild>
                <Link href="/settings">Connect Meta</Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <div className="hidden min-h-0 flex-1 md:flex">
            <AdsTable
              table={table}
              density={density}
              canEdit={canEdit}
              activeId={activeId}
              onActivate={(id) => {
                setActiveId(id);
                lastClicked.current = id;
              }}
              onToggle={onToggle}
              onOpen={(r) => setDrawerId(r.id)}
              onBudget={(row, el) => setBudgetEdit({ row, rect: el.getBoundingClientRect() })}
              onSelectRange={selectRange}
              onDuplicate={canEdit ? onDuplicateRow : undefined}
              onEdit={canEdit ? onEditRow : undefined}
              scrollRef={scrollRef}
              totalReach={totalReach}
            />
          </div>
          <MobileCards rows={table.getRowModel().rows.map((r) => r.original)} canEdit={canEdit} onToggle={onToggle} onOpen={(r) => setDrawerId(r.id)} />
        </>
      )}

      {selectedRows.length > 0 && canEdit && (
        <div
          role="toolbar"
          aria-label="Bulk actions"
          className="fixed bottom-6 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-card border border-slate-6 bg-slate-1 p-1.5 shadow-float animate-in fade-in-0 slide-in-from-bottom-2 dark:bg-slate-2"
        >
          <span className="px-2 text-ui font-medium tabular-nums">{selectedRows.length} selected</span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus(selectedRows, "PAUSED")}>
            <Pause />
            Pause
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirm(selectedRows)}>
            <Play />
            Activate
          </Button>
          {level !== "ad" && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" disabled={busy}>
                  Budget ±%
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent side="top" align="center">
                {[-20, -10, 10, 20].map((p) => (
                  <DropdownMenuItem key={p} onSelect={() => adjustBudgets(p)}>
                    {p > 0 ? `+${p}%` : `${p}%`}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {selectedRows.length === 1 && (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setEditRow(selectedRows[0]!)}>
              <Pencil />
              Edit
            </Button>
          )}
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDuplicateRows(selectedRows)}>
            <CopyPlus />
            Duplicate
          </Button>
          <Button size="icon-sm" variant="ghost" aria-label="Clear selection" onClick={() => setRowSelection({})}>
            <X />
          </Button>
        </div>
      )}

      <DuplicateDialog
        rows={duplicateRows}
        onClose={() => setDuplicateRows(null)}
        onDone={(res) => {
          report(res);
          if (res.ok) {
            setDuplicateRows(null);
            setRowSelection({});
            router.refresh();
          }
        }}
      />
      <EditDialog
        key={editRow?.id ?? "none"}
        row={editRow}
        onClose={() => setEditRow(null)}
        onDone={(res) => {
          report(res);
          if (res.ok) {
            setEditRow(null);
            router.refresh();
          }
        }}
      />
      <ActivateDialog rows={confirm} budgets={budgets} onClose={() => setConfirm(null)} onConfirm={(rows) => (setConfirm(null), setStatus(rows, "ACTIVE"))} />
      {budgetEdit && (
        <BudgetEditor
          key={budgetEdit.row.id}
          row={budgetEdit.row}
          rect={budgetEdit.rect}
          budget={budgets[budgetEdit.row.adAccountId]}
          onClose={() => setBudgetEdit(null)}
          onSave={(minor) =>
            startBusy(async () => {
              const res = await setBudgetAction(level, budgetEdit.row.id, minor);
              report(res);
              if (res.ok) {
                setBudgetEdit(null);
                router.refresh();
              }
            })
          }
          busy={busy}
        />
      )}
      <SaveViewDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onSave={(name) =>
          startBusy(async () => {
            const res = await saveViewAction({ name, level, columns, filters: { status: statusFilter, search, preset, density }, sort: sorting.slice(0, 3) });
            report(res);
            if (res.ok) setSaveOpen(false);
          })
        }
      />
      <DetailDrawer row={drawerRow} range={range} canEdit={canEdit} onClose={() => setDrawerId(null)} onToggle={onToggle} />
    </div>
  );
}

function SelectAll({ table }: { table: TanstackTable<TableRow> }) {
  return (
    <input
      type="checkbox"
      aria-label="Select all rows"
      className="size-4 accent-iris-9"
      checked={table.getIsAllRowsSelected()}
      ref={(el) => {
        if (el) el.indeterminate = table.getIsSomeRowsSelected();
      }}
      onChange={table.getToggleAllRowsSelectedHandler()}
    />
  );
}

function SelectedCount({ n }: { n: number }) {
  return <span className="ml-1.5 rounded-full bg-iris-4 px-1.5 text-label text-iris-11 tabular-nums">{n}</span>;
}

/** Activation always confirms, showing the daily budget it releases (docs/spec.md → Spend guardrails). */
function ActivateDialog({ rows, budgets, onClose, onConfirm }: { rows: TableRow[] | null; budgets: AccountBudgets; onClose: () => void; onConfirm: (rows: TableRow[]) => void }) {
  const byAccount = React.useMemo(() => {
    const m = new Map<string, { name: string; currency: string; released: number }>();
    for (const r of rows ?? []) {
      if (r.status === "ACTIVE") continue;
      const e = m.get(r.adAccountId) ?? { name: r.accountName, currency: r.currency, released: 0 };
      if (r.budgetFrom === null && r.dailyBudget) e.released += r.dailyBudget;
      m.set(r.adAccountId, e);
    }
    return [...m.entries()];
  }, [rows]);
  const targets = rows?.filter((r) => r.status !== "ACTIVE") ?? [];

  return (
    <Dialog open={rows !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && targets.length) onConfirm(targets);
        }}
      >
        <DialogHeader>
          <DialogTitle>{targets.length === 1 ? `Activate ${targets[0]!.name}?` : `Activate ${targets.length} items?`}</DialogTitle>
          <DialogDescription>Ads start spending as soon as Meta approves them.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 px-5 py-4 text-ui">
          {targets.length === 0 && <p className="text-slate-11">Everything selected is already active.</p>}
          {byAccount.map(([id, a]) => {
            const b = budgets[id];
            const total = (b?.total ?? 0) + a.released;
            const over = b?.max !== null && b?.max !== undefined && total > b.max;
            return (
              <div key={id} className={cn("rounded-control border px-3 py-2", over ? "border-amber-7 bg-amber-2" : "border-slate-6")}>
                <p className="font-medium">{a.name}</p>
                <p className="text-slate-11 tabular-nums">
                  Releases {a.released ? `${formatMoney(a.released, a.currency, { compact: false })}/day` : "no budget of its own"} · account total{" "}
                  {formatMoney(total, a.currency, { compact: false })}/day
                  {b?.max !== null && b?.max !== undefined && ` of ${formatMoney(b.max, a.currency, { compact: false })} max`}
                </p>
                {over && <p className="mt-1 text-amber-11">This goes over the account&apos;s max daily budget.</p>}
              </div>
            );
          })}
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" disabled={targets.length === 0} onClick={() => onConfirm(targets)}>
              Activate
              <Kbd className="border-white/30 bg-white/15 text-white">⌘↵</Kbd>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function BudgetEditor({
  row,
  rect,
  budget,
  busy,
  onClose,
  onSave,
}: {
  row: TableRow;
  rect: DOMRect;
  budget: AccountBudgets[string] | undefined;
  busy: boolean;
  onClose: () => void;
  onSave: (minor: number) => void;
}) {
  const current = row.dailyBudget ?? 0;
  const [value, setValue] = React.useState(moneyInputValue(current, row.currency));
  const minor = parseMoneyInput(value, row.currency);
  const newTotal = budget && minor !== null ? budget.total - (row.status === "ACTIVE" ? current : 0) + (row.status === "ACTIVE" ? minor : 0) : null;
  const over = budget?.max !== null && budget?.max !== undefined && newTotal !== null && newTotal > budget.max;
  const change = minor !== null && current ? (minor - current) / current : 0;
  const { user } = useShell();
  const tooBig = user.role === "buyer" && Math.abs(change) * 100 > user.maxBudgetChangePct + 1e-9;

  return (
    <Popover open onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <div aria-hidden style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width, height: rect.height, pointerEvents: "none" }} />
      </PopoverAnchor>
      <PopoverContent align="end" className="w-80 p-3">
        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (minor && minor > 0 && minor !== current) onSave(minor);
          }}
        >
          <p className="text-ui font-medium">Daily budget · {row.name}</p>
          <div className="flex items-center gap-2">
            <Input autoFocus value={value} onChange={(e) => setValue(e.target.value)} inputMode="decimal" aria-label={`Daily budget in ${row.currency}`} className="text-right tabular-nums" />
            <span className="text-ui text-slate-11">{row.currency}</span>
          </div>
          <div className="grid grid-cols-4 gap-1">
            {[-20, -10, 10, 20].map((p) => (
              <Button key={p} size="sm" onClick={() => setValue(moneyInputValue(Math.round(current * (1 + p / 100)), row.currency))}>
                {p > 0 ? `+${p}%` : `${p}%`}
              </Button>
            ))}
          </div>
          {newTotal !== null && (
            <p className={cn("text-ui tabular-nums", over ? "text-amber-11" : "text-slate-11")}>
              Account daily total {formatMoney(newTotal, row.currency, { compact: false })}
              {budget?.max !== null && budget?.max !== undefined && ` of ${formatMoney(budget.max, row.currency, { compact: false })} max`}
              {over && " — over the limit"}
            </p>
          )}
          {tooBig ? (
            <p className="text-ui text-red-11">
              Buyers can move a budget at most {user.maxBudgetChangePct}% per step. This is {Math.round(Math.abs(change) * 100)}%.
            </p>
          ) : (
            Math.abs(change) > 0.3 && <p className="text-ui text-amber-11">That&apos;s a {Math.round(Math.abs(change) * 100)}% change in one step.</p>
          )}
          <div className="flex justify-end gap-2">
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={busy || !minor || minor === current || tooBig}>
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function SaveViewDialog({ open, onOpenChange, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; onSave: (name: string) => void }) {
  const [name, setName] = React.useState("");
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Save view</DialogTitle>
          <DialogDescription>Columns, filters, density and sort for this level.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-3 px-5 py-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim()) onSave(name.trim());
          }}
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Winners by ROAS" aria-label="View name" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" variant="primary" disabled={!name.trim()}>
              Save view
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Below 768px: read-only cards with pause and activate (docs/spec.md → Responsive). */
function MobileCards({ rows, canEdit, onToggle, onOpen }: { rows: TableRow[]; canEdit: boolean; onToggle: (r: TableRow, on: boolean) => void; onOpen: (r: TableRow) => void }) {
  return (
    <ul className="grid gap-2 md:hidden">
      {rows.slice(0, 200).map((r) => (
        <li key={r.id} className="flex items-center gap-3 rounded-card border border-slate-6 px-3 py-2.5">
          <button type="button" className="min-w-0 flex-1 text-left" onClick={() => onOpen(r)}>
            <p className="truncate text-ui font-medium">{r.name}</p>
            <p className="flex items-center gap-2 text-label text-slate-11 tabular-nums">
              <StatusDot tone={r.delivery.tone} label={r.delivery.label} />
              <span>{formatMoney(r.spend, r.currency)}</span>
              <span>{formatRoas(r.roas)}</span>
            </p>
          </button>
          <Switch checked={r.status === "ACTIVE"} disabled={!canEdit} aria-label={`${r.status === "ACTIVE" ? "Pause" : "Activate"} ${r.name}`} onCheckedChange={(on) => onToggle(r, on)} />
        </li>
      ))}
    </ul>
  );
}
