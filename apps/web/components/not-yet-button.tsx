"use client";

import * as React from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

/** A button for a flow that a later build session wires up. */
export function NotYetButton({
  message,
  ...props
}: React.ComponentProps<typeof Button> & { message: string }) {
  return <Button {...props} onClick={() => toast("Not available yet", { description: message })} />;
}
