"use client";

import * as React from "react";
import { Button } from "./button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./dialog";
import { Kbd } from "./kbd";

type ConfirmOptions = { title: string; description: string; confirmLabel: string; destructive?: boolean };

/**
 * `const { confirm, dialog } = useConfirm()`; render `dialog`, then
 * `if (await confirm({...}))`. ⌘Enter confirms, Esc cancels.
 */
export function useConfirm() {
  const [state, setState] = React.useState<(ConfirmOptions & { resolve: (ok: boolean) => void }) | null>(null);

  const confirm = React.useCallback((options: ConfirmOptions) => new Promise<boolean>((resolve) => setState({ ...options, resolve })), []);
  const close = (ok: boolean) => {
    state?.resolve(ok);
    setState(null);
  };

  const dialog = (
    <Dialog open={state !== null} onOpenChange={(open) => !open && close(false)}>
      <DialogContent
        className="max-w-md"
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) close(true);
        }}
      >
        {state && (
          <>
            <DialogHeader>
              <DialogTitle>{state.title}</DialogTitle>
              <DialogDescription>{state.description}</DialogDescription>
            </DialogHeader>
            <div className="flex justify-end gap-2 px-5 pb-5">
              <Button variant="ghost" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button variant={state.destructive ? "destructive" : "primary"} onClick={() => close(true)}>
                {state.confirmLabel} <Kbd className="ml-1">⌘↵</Kbd>
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );

  return { confirm, dialog };
}
