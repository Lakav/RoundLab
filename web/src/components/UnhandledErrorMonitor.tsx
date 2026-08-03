"use client";

import { useEffect, useState } from "react";
import { ErrorRecoveryPanel } from "./ErrorRecoveryPanel";
import type { DiagnosticSource } from "@/lib/local-diagnostic";

export function UnhandledErrorMonitor() {
  const [failure, setFailure] = useState<{ error: unknown; source: DiagnosticSource } | null>(null);

  useEffect(() => {
    const onError = (event: ErrorEvent) => {
      setFailure({ error: event.error ?? new Error("Unhandled browser error"), source: "unhandled-error" });
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      setFailure({ error: event.reason, source: "unhandled-rejection" });
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  if (!failure) return null;
  return (
    <div className="fixed inset-x-4 bottom-4 z-[120] mx-auto max-w-2xl">
      <ErrorRecoveryPanel
        compact
        error={failure.error}
        source={failure.source}
        onRetry={() => window.location.reload()}
        onDismiss={() => setFailure(null)}
      />
    </div>
  );
}
