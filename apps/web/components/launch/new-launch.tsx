"use client";

import * as React from "react";
import { Rocket } from "lucide-react";
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
          New launch
        </h2>
        <p className="text-ui text-slate-11">
          {creativeIds.length
            ? `${creativeIds.length} ${creativeIds.length === 1 ? "file" : "files"} from the library come along. Pick where they go.`
            : "Pick a preset: brand × market. You can change it in the first step."}
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
        <Button variant="primary" disabled={!presetId || pending} onClick={() => start(() => createDraft(presetId, creativeIds))}>
          <Rocket /> {pending ? "Starting…" : "Start launch"}
        </Button>
      </div>
    </section>
  );
}
