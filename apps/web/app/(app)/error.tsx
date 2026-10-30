"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={TriangleAlert}
      title="This page failed to load"
      description={
        error.digest
          ? `Something went wrong on the server (ref ${error.digest}). Try again; if it keeps failing, check Sentry for this reference.`
          : "Something went wrong while loading this page. Try again; if it keeps failing, reload the app."
      }
      action={
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
      }
    />
  );
}
