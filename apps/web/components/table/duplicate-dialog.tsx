"use client";

import * as React from "react";
import { duplicateAction, loadDuplicateTargets, type DuplicateTarget } from "@/app/(app)/ads/actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect } from "@/components/ui/input";
import type { ActionResult } from "@/lib/server/action-result";
import { cn } from "@/lib/utils";
import type { TableRow } from "./columns";

const NOUN = { campaign: ["campaign", "campaigns"], adset: ["ad set", "ad sets"], ad: ["ad", "ads"] } as const;
const PARENT = { adset: "campaign", ad: "ad set" } as const;

/**
 * Ads Manager's Duplicate: into the original parent or an existing one in the same
 * account, any number of copies. Everything is created paused.
 */
export function DuplicateDialog({ rows, onClose, onDone }: { rows: TableRow[] | null; onClose: () => void; onDone: (res: ActionResult<unknown>) => void }) {
  const level = rows?.[0]?.level ?? "campaign";
  const accounts = new Set(rows?.map((r) => r.adAccountId));
  const sameAccount = accounts.size === 1;
  const [where, setWhere] = React.useState<"original" | "existing" | "new">("original");
  const parentName = rows?.[0] ? (level === "adset" ? rows[0].campaignName : rows[0].adsetName) : null;
  const [newName, setNewName] = React.useState("");
  const [targets, setTargets] = React.useState<DuplicateTarget[] | null>(null);
  const [targetId, setTargetId] = React.useState("");
  const [copies, setCopies] = React.useState(1);
  const [busy, start] = React.useTransition();
  const open = rows !== null && rows.length > 0;

  const chooseExisting = () => {
    setWhere("existing");
    if (targets || level === "campaign" || !rows?.[0]) return;
    void loadDuplicateTargets(level, rows[0].adAccountId).then((res) => setTargets(res.ok ? (res.data ?? []) : []));
  };

  const reset = () => {
    setWhere("original");
    setNewName("");
    setTargets(null);
    setTargetId("");
    setCopies(1);
  };

  if (!rows) return null;
  const [one, many] = NOUN[level];
  const noun = rows.length === 1 ? one : many;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) {
          reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            Duplicate {rows.length === 1 ? noun : `${rows.length} ${noun}`}
          </DialogTitle>
          <DialogDescription>Copies keep every setting{level !== "ad" ? " and everything inside" : ""}, get &quot;- Copy&quot; on the name, and are created paused.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 px-5 pb-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await duplicateAction(level, rows.map((r) => r.id), {
                copies,
                destinationId: where === "existing" ? targetId : null,
                newParentName: where === "new" ? newName.trim() : null,
              });
              onDone(res);
              if (res.ok) reset();
            });
          }}
        >
          {level !== "campaign" && (
            <fieldset className="grid gap-2">
              <legend className="mb-1.5 text-label font-medium text-slate-11">Duplicate into</legend>
              {(["original", "existing", "new"] as const).map((w) => (
                <label
                  key={w}
                  className={cn(
                    "flex cursor-default items-center gap-2.5 rounded-control border px-3 py-2 text-ui has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-iris-8",
                    where === w ? "border-iris-8 bg-iris-2" : "border-slate-6",
                    w !== "original" && !sameAccount && "opacity-50",
                  )}
                >
                  <input
                    type="radio"
                    name="where"
                    className="accent-iris-9"
                    checked={where === w}
                    disabled={w !== "original" && !sameAccount}
                    onChange={() => {
                      if (w === "existing") return chooseExisting();
                      if (w === "new" && !newName) setNewName(parentName ? `${parentName} - Copy` : "");
                      setWhere(w);
                    }}
                  />
                  {w === "original" ? `Original ${PARENT[level]}` : w === "existing" ? `Existing ${PARENT[level]}` : `New ${PARENT[level]}`}
                </label>
              ))}
              {!sameAccount && <p className="text-label text-slate-11">These are in different ad accounts, so copies stay with their originals.</p>}
              {where === "new" && rows.length > 1 && <p className="text-label text-slate-11">All copies go into one new {PARENT[level]}, made from the first selected {one}&apos;s {PARENT[level]}.</p>}
            </fieldset>
          )}

          {where === "new" && level !== "campaign" && (
            <Field
              label={`New ${PARENT[level]} name`}
              htmlFor="duplicate-new-name"
              hint={level === "adset" ? "Same settings as the original campaign (objective, budget, bid strategy), created paused." : "Same settings as the original ad set (budget, audience, placements), created paused in the same campaign."}
            >
              <Input id="duplicate-new-name" required maxLength={400} value={newName} onChange={(e) => setNewName(e.target.value)} />
            </Field>
          )}

          {where === "existing" && level !== "campaign" && (
            <Field label={`Choose ${PARENT[level]}`} htmlFor="duplicate-target">
              <NativeSelect id="duplicate-target" required value={targetId} onChange={(e) => setTargetId(e.target.value)} disabled={!targets}>
                <option value="">{targets ? `Select a ${PARENT[level]}…` : "Loading…"}</option>
                {targets?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.parentName ? `${t.parentName} ▸ ${t.name}` : t.name}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          )}

          <Field label="Number of copies" htmlFor="duplicate-copies" hint={rows.length > 1 ? `Each selected ${one} is copied this many times.` : undefined}>
            <Input
              id="duplicate-copies"
              type="number"
              min={1}
              max={10}
              className="w-24 tabular-nums"
              value={copies}
              onChange={(e) => setCopies(Math.min(10, Math.max(1, Number(e.target.value) || 1)))}
            />
          </Field>

          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                reset();
                onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || (where === "existing" && !targetId) || (where === "new" && !newName.trim())}>
              {busy ? "Duplicating…" : "Duplicate"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
