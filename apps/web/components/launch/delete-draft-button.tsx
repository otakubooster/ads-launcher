"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteDraft } from "@/app/(app)/launch/actions";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm";

/**
 * Deletes a draft (campaign editor or bulk launch) after a confirm. Nothing was
 * created on Meta, so only the draft goes. `after` = stay and refresh the list,
 * or go back to /launch from inside the draft.
 */
export function DeleteDraftButton({ id, name, after = "refresh", withLabel = false, onDeleting }: { id: string; name: string; after?: "refresh" | "launch"; withLabel?: boolean; onDeleting?: () => void }) {
  const router = useRouter();
  const { confirm, dialog } = useConfirm();
  const [busy, start] = React.useTransition();

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size={withLabel ? "sm" : "icon-sm"}
        className="shrink-0 text-slate-11 hover:text-red-11"
        aria-label={withLabel ? undefined : `Delete draft ${name}`}
        title="Delete draft"
        disabled={busy}
        onClick={async () => {
          const ok = await confirm({ title: `Delete ${name || "this draft"}?`, description: "The draft and its settings are deleted. Nothing was created on Meta.", confirmLabel: "Delete draft", destructive: true });
          if (!ok) return;
          onDeleting?.();
          start(async () => {
            const res = await deleteDraft(id);
            if (!res.ok) return void toast.error(res.error.title, { description: res.error.detail });
            toast.success("Draft deleted");
            if (after === "launch") router.push("/launch");
            else router.refresh();
          });
        }}
      >
        <Trash2 />
        {withLabel && "Delete draft"}
      </Button>
      {dialog}
    </>
  );
}
