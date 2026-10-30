"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CloudUpload } from "lucide-react";
import { toast } from "sonner";
import { updateTags, uploadToAccounts } from "@/app/(app)/creatives/actions";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/input";

export function CreativeDetailActions({
  creativeIds,
  tags,
  accounts,
  canEdit,
}: {
  creativeIds: string[];
  tags: { angle?: string; hook?: string; format?: string; language?: string };
  accounts: { id: string; name: string }[];
  canEdit: boolean;
}) {
  const router = useRouter();
  const [busy, start] = React.useTransition();
  const [account, setAccount] = React.useState(accounts[0]?.id ?? "");

  return (
    <section aria-labelledby="details-title" className="rounded-card border border-slate-6 p-4">
      <h2 id="details-title" className="text-section font-semibold">
        Tags and upload
      </h2>
      <form
        className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4"
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          start(async () => {
            const res = await updateTags(creativeIds, Object.fromEntries(["angle", "hook", "format", "language"].map((k) => [k, String(fd.get(k) ?? "")])));
            if (res.ok) toast.success(res.message ?? "Saved");
            else toast.error(res.error.title, { description: res.error.detail });
            router.refresh();
          });
        }}
      >
        {(["angle", "hook", "format", "language"] as const).map((k) => (
          <Field key={k} label={k.charAt(0).toUpperCase() + k.slice(1)} htmlFor={`tag-${k}`}>
            <Input id={`tag-${k}`} name={k} defaultValue={tags[k] ?? ""} disabled={!canEdit} />
          </Field>
        ))}
        {canEdit && (
          <Button type="submit" disabled={busy} className="col-span-2 justify-self-start sm:col-span-4">
            Save tags
          </Button>
        )}
      </form>
      {canEdit && accounts.length > 0 && (
        <div className="mt-4 flex flex-wrap items-end gap-2 border-t border-slate-6 pt-4">
          <Field label="Upload to ad account" htmlFor="upload-account" className="w-56">
            <NativeSelect id="upload-account" value={account} onChange={(e) => setAccount(e.target.value)}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Button
            disabled={busy || !account}
            onClick={() =>
              start(async () => {
                const res = await uploadToAccounts(creativeIds, [account]);
                if (res.ok) toast.success(res.message ?? "Uploaded");
                else toast.error(res.error.title, { description: [res.error.detail, res.error.fix].filter(Boolean).join(" ") });
                router.refresh();
              })
            }
          >
            <CloudUpload />
            {busy ? "Uploading…" : "Upload to Meta"}
          </Button>
        </div>
      )}
    </section>
  );
}
