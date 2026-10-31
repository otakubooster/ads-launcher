"use client";

import * as React from "react";
import { Layers, Plus } from "lucide-react";
import { createCampaignDraft } from "@/app/(app)/create/actions";
import { createDraft } from "@/app/(app)/launch/actions";
import { Button } from "@/components/ui/button";
import { Field, NativeSelect } from "@/components/ui/input";

export function NewLaunch({ presets, creativeIds }: { presets: { id: string; label: string }[]; creativeIds: string[] }) {
  const [presetId, setPresetId] = React.useState(presets[0]?.id ?? "");
  const [pending, start] = React.useTransition();
  return (
    <section aria-labelledby="new-launch-title" className="grid gap-3 rounded-card border border-slate-6 p-4">
      <div>
        <h2 id="new-launch-title" className="text-section font-semibold">
          Create
        </h2>
        <p className="text-ui text-slate-11">
          {creativeIds.length
            ? `${creativeIds.length} ${creativeIds.length === 1 ? "file" : "files"} from the library come along. Pick where they go.`
            : "Pick a preset (brand × market). Create campaign opens an Ads Manager-style editor; Bulk launch builds many ads from creatives × copy."}
        </p>
      </div>
      <div className="flex items-end gap-2">
        <Field label="Preset" htmlFor="new-launch-preset" className="flex-1">
          <NativeSelect id="new-launch-preset" value={presetId} onChange={(e) => setPresetId(e.target.value)}>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Button variant={creativeIds.length ? "secondary" : "primary"} disabled={!presetId || pending} onClick={() => start(() => createCampaignDraft(presetId))}>
          <Plus /> Create campaign
        </Button>
        <Button variant={creativeIds.length ? "primary" : "secondary"} disabled={!presetId || pending} onClick={() => start(() => createDraft(presetId, creativeIds))}>
          <Layers /> {pending ? "Starting…" : "Bulk launch"}
        </Button>
      </div>
    </section>
  );
}
