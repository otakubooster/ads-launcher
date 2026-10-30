"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Copy as CopyIcon, Languages, Plus, Trash2, Type, X } from "lucide-react";
import { toast } from "sonner";
import { deleteCopySet, duplicateCopySet, saveCopySet } from "@/app/(app)/copy/actions";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/input";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { TimeAgo } from "@/components/ui/time-ago";
import type { ActionResult } from "@/lib/server/action-result";
import { cn } from "@/lib/utils";
import { COPY_LIMITS, CTA_TYPES, label } from "@fahd/shared/meta-options";

type CopySet = { id: string; name: string; brandId: string; language: string; primaryTexts: string[]; headlines: string[]; descriptions: string[]; ctaType: string; updatedAt: string };

function notify(res: ActionResult<unknown>) {
  if (res.ok) toast.success(res.message ?? "Saved");
  else toast.error(res.error.title, { description: [res.error.detail, res.error.fix].filter(Boolean).join(" ") });
}

export function CopyView({ sets, brands, canEdit }: { sets: CopySet[]; brands: { id: string; name: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = React.useState<Partial<CopySet> | null>(null);
  const [busy, start] = React.useTransition();
  const [duplicating, setDuplicating] = React.useState<CopySet | null>(null);
  const { confirm, dialog } = useConfirm();
  const brandName = (id: string) => brands.find((b) => b.id === id)?.name ?? "—";

  return (
    <>
      {canEdit && (
        <Button variant="primary" className="mb-4" onClick={() => setEditing({ brandId: brands[0]?.id, language: "en", primaryTexts: [""], headlines: [""], descriptions: [""], ctaType: "SHOP_NOW" })} disabled={brands.length === 0}>
          <Plus />
          New copy set
        </Button>
      )}
      {sets.length === 0 ? (
        <EmptyState icon={Type} title="No copy sets yet" description="Save up to five primary texts and headlines once, then reuse them in any launch." />
      ) : (
        <div className="overflow-x-auto rounded-card border border-slate-6">
          <table className="w-full min-w-[720px] text-ui">
            <thead>
              <tr className="text-label text-slate-11">
                {["Name", "Brand", "Language", "Texts", "CTA", "Last edited", ""].map((h, i) => (
                  <th key={i} scope="col" className={cn("h-9 border-b border-slate-6 bg-slate-2 px-3 font-medium", i === 3 ? "text-right" : "text-left")}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sets.map((s) => (
                <tr key={s.id} className="h-10 hover:bg-slate-3">
                  <td className="border-b border-slate-6 px-3">
                    <button type="button" className="font-medium hover:underline" onClick={() => setEditing(s)}>
                      {s.name}
                    </button>
                  </td>
                  <td className="border-b border-slate-6 px-3 text-slate-11">{brandName(s.brandId)}</td>
                  <td className="border-b border-slate-6 px-3 text-slate-11 uppercase">{s.language}</td>
                  <td className="border-b border-slate-6 px-3 text-right text-slate-11 tabular-nums">
                    {s.primaryTexts.length} · {s.headlines.length} · {s.descriptions.length}
                  </td>
                  <td className="border-b border-slate-6 px-3 text-slate-11">{label(s.ctaType)}</td>
                  <td className="border-b border-slate-6 px-3 text-slate-11"><TimeAgo iso={s.updatedAt} /></td>
                  <td className="border-b border-slate-6 px-3 text-right">
                    {canEdit && (
                      <span className="inline-flex gap-1">
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label={`Duplicate ${s.name} to another language`}
                          disabled={busy}
                          onClick={() => setDuplicating(s)}
                        >
                          <Languages />
                        </Button>
                        <Button size="icon-sm" variant="ghost" aria-label={`Delete ${s.name}`} disabled={busy} onClick={async () => {
                          if (await confirm({ title: `Delete ${s.name}?`, description: "Launches that used it keep their copy. It won't be offered for new launches.", confirmLabel: "Delete copy set", destructive: true })) {
                            start(async () => (notify(await deleteCopySet(s.id)), router.refresh()));
                          }
                        }}>
                          <Trash2 />
                        </Button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <DuplicateDialog
        set={duplicating}
        onClose={() => setDuplicating(null)}
        onDuplicate={(id, language) =>
          start(async () => {
            const res = await duplicateCopySet(id, language);
            notify(res);
            if (res.ok) setDuplicating(null);
            router.refresh();
          })
        }
        busy={busy}
      />
      {dialog}
      <Sheet open={editing !== null} onOpenChange={(o) => !o && setEditing(null)}>
        <SheetContent side="right" aria-describedby={undefined} className="w-[520px]">
          {editing && <CopyEditor key={editing.id ?? "new"} set={editing} brands={brands} canEdit={canEdit} onDone={() => (setEditing(null), router.refresh())} />}
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Copies a set to another language; translating the texts is up to the editor. */
function DuplicateDialog({ set, onClose, onDuplicate, busy }: { set: CopySet | null; onClose: () => void; onDuplicate: (id: string, language: string) => void; busy: boolean }) {
  const [language, setLanguage] = React.useState("");
  return (
    <Dialog
      open={set !== null}
      onOpenChange={(o) => {
        if (!o) {
          setLanguage("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Duplicate to another language</DialogTitle>
          <DialogDescription>A copy of {set?.name} you can then translate. The original stays as it is.</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 px-5 pb-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (set && language.trim()) onDuplicate(set.id, language.trim().toLowerCase());
          }}
        >
          <Field label="Language" htmlFor="duplicate-language" hint="ISO code, e.g. fr or de.">
            <Input id="duplicate-language" value={language} onChange={(e) => setLanguage(e.target.value)} maxLength={10} autoFocus required />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={busy || !language.trim()}>
              Duplicate
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CopyEditor({ set, brands, canEdit, onDone }: { set: Partial<CopySet>; brands: { id: string; name: string }[]; canEdit: boolean; onDone: () => void }) {
  const [state, action, pending] = React.useActionState(async (prev: ActionResult | null, fd: FormData) => {
    const res = await saveCopySet(prev, fd);
    if (res.ok) {
      notify(res);
      onDone();
    }
    return res;
  }, null);

  return (
    <form action={action} className="flex min-h-0 flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-slate-6 px-5 py-4">
        <SheetTitle className="text-section font-semibold">{set.id ? "Edit copy set" : "New copy set"}</SheetTitle>
        <SheetClose aria-label="Close" className="inline-flex size-8 items-center justify-center rounded-control text-slate-11 hover:bg-slate-3">
          <X className="size-4" />
        </SheetClose>
      </header>
      <fieldset disabled={!canEdit} className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-4">
        <input type="hidden" name="id" value={set.id ?? ""} />
        <Field label="Name" htmlFor="c-name">
          <Input id="c-name" name="name" defaultValue={set.name} required />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="Brand" htmlFor="c-brand">
            <NativeSelect id="c-brand" name="brandId" defaultValue={set.brandId}>
              {brands.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field label="Language" htmlFor="c-lang">
            <Input id="c-lang" name="language" defaultValue={set.language} required />
          </Field>
          <Field label="CTA" htmlFor="c-cta">
            <NativeSelect id="c-cta" name="ctaType" defaultValue={set.ctaType}>
              {CTA_TYPES.map((c) => (
                <option key={c} value={c}>
                  {label(c)}
                </option>
              ))}
            </NativeSelect>
          </Field>
        </div>
        <TextList name="primaryTexts" label="Primary text" initial={set.primaryTexts ?? [""]} limit={COPY_LIMITS.primaryText} multiline />
        <TextList name="headlines" label="Headline" initial={set.headlines ?? [""]} limit={COPY_LIMITS.headline} />
        <TextList name="descriptions" label="Description" initial={set.descriptions ?? [""]} limit={COPY_LIMITS.description} />
        {state && !state.ok && (
          <p role="alert" className="rounded-control border border-red-6 bg-red-2 px-3 py-2 text-ui text-red-11">
            {state.error.detail}
          </p>
        )}
      </fieldset>
      {canEdit && (
        <footer className="flex justify-end gap-2 border-t border-slate-6 px-5 py-3">
          <Button type="submit" variant="primary" disabled={pending}>
            {pending ? "Saving…" : "Save copy set"}
          </Button>
        </footer>
      )}
    </form>
  );
}

/** Up to five entries with a character counter against Meta's recommended length. */
export function TextList({ name, label: title, initial, limit, multiline }: { name: string; label: string; initial: string[]; limit: number; multiline?: boolean }) {
  const [values, setValues] = React.useState(initial.length ? initial : [""]);
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-label font-medium text-slate-11">
        {title}s · up to {COPY_LIMITS.perType}
      </legend>
      {values.map((v, i) => {
        const Comp = multiline ? Textarea : Input;
        return (
          <div key={i} className="grid gap-1">
            <div className="flex items-start gap-1">
              <Comp
                name={name}
                value={v}
                aria-label={`${title} ${i + 1}`}
                onChange={(e: React.ChangeEvent<HTMLInputElement & HTMLTextAreaElement>) => setValues((vs) => vs.map((x, j) => (j === i ? e.target.value : x)))}
                className={multiline ? "min-h-16" : undefined}
              />
              {values.length > 1 && (
                <Button size="icon" variant="ghost" aria-label={`Remove ${title.toLowerCase()} ${i + 1}`} onClick={() => setValues((vs) => vs.filter((_, j) => j !== i))}>
                  <X />
                </Button>
              )}
            </div>
            <p className={cn("text-right text-label tabular-nums", v.length > limit ? "text-amber-11" : "text-slate-11")}>
              {v.length}/{limit}
              {v.length > limit && " · may be cut off"}
            </p>
          </div>
        );
      })}
      {values.length < COPY_LIMITS.perType && (
        <Button size="sm" variant="ghost" className="justify-self-start" onClick={() => setValues((vs) => [...vs, ""])}>
          <CopyIcon />
          Add {title.toLowerCase()}
        </Button>
      )}
    </fieldset>
  );
}
