"use client";

import { useEffect } from "react";
import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("RoundLab route error", error.name);
  }, [error]);
  return (
    <main id="main-content" className="flex min-h-screen items-center px-4 py-20">
      <ErrorRecoveryPanel error={error} source="route-boundary" onRetry={reset} />
    </main>
  );
}
