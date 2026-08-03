"use client";

import { ErrorRecoveryPanel } from "@/components/ErrorRecoveryPanel";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="fr" className="h-full bg-neutral-950">
      <body className="min-h-full bg-neutral-950 text-neutral-100">
        <main className="flex min-h-screen items-center px-4 py-20">
          <ErrorRecoveryPanel error={error} source="global-boundary" onRetry={reset} />
        </main>
      </body>
    </html>
  );
}
