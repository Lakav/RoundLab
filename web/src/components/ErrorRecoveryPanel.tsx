"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  createLocalDiagnostic,
  downloadLocalDiagnostic,
  serializeLocalDiagnostic,
  type DiagnosticSource,
} from "@/lib/local-diagnostic";

export function ErrorRecoveryPanel({
  error,
  source,
  onRetry,
  onDismiss,
  compact = false,
}: {
  error: unknown;
  source: DiagnosticSource;
  onRetry?: () => void;
  onDismiss?: () => void;
  compact?: boolean;
}) {
  const diagnostic = useMemo(() => createLocalDiagnostic(error, source), [error, source]);
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");

  const copyDiagnostic = async () => {
    try {
      await navigator.clipboard.writeText(serializeLocalDiagnostic(diagnostic));
      setCopyStatus("copied");
    } catch {
      setCopyStatus("failed");
    }
  };

  return (
    <section
      role="alert"
      aria-labelledby="roundlab-error-title"
      className={[
        "rounded-xl border border-rose-300/20 bg-[#151313] text-[var(--rl-fg)] shadow-2xl",
        compact ? "p-4" : "mx-auto w-full max-w-2xl p-6 sm:p-8",
      ].join(" ")}
    >
      <h1 id="roundlab-error-title" className={compact ? "text-base font-semibold" : "text-2xl font-semibold"}>
        Une erreur a interrompu RoundLab
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-[var(--rl-fg-muted)]">
        Tes démos restent locales. Le diagnostic proposé exclut les données de match, les Steam IDs,
        les noms de joueurs, les chemins locaux, le message brut et la stack.
      </p>
      <p className="mt-3 text-xs text-[var(--rl-fg-dim)]">
        Catégorie détectée : <span className="font-semibold text-[var(--rl-fg-muted)]">{diagnostic.category}</span>
      </p>
      <div className="mt-5 flex flex-wrap gap-2">
        {onRetry && (
          <button type="button" onClick={onRetry} className="rounded-md bg-emerald-300 px-3 py-2 text-sm font-semibold text-neutral-950">
            Réessayer
          </button>
        )}
        <Link href="/" className="rounded-md border border-[var(--rl-border)] px-3 py-2 text-sm font-semibold text-[var(--rl-fg)] hover:bg-white/[0.05]">
          Revenir à l’accueil
        </Link>
        <button type="button" onClick={() => void copyDiagnostic()} className="rounded-md border border-[var(--rl-border)] px-3 py-2 text-sm text-[var(--rl-fg-muted)] hover:bg-white/[0.05]">
          Copier le diagnostic
        </button>
        <button type="button" onClick={() => downloadLocalDiagnostic(diagnostic)} className="rounded-md border border-[var(--rl-border)] px-3 py-2 text-sm text-[var(--rl-fg-muted)] hover:bg-white/[0.05]">
          Télécharger le diagnostic
        </button>
        {onDismiss && (
          <button type="button" onClick={onDismiss} className="rounded-md px-3 py-2 text-sm text-[var(--rl-fg-dim)] hover:text-[var(--rl-fg)]">
            Fermer
          </button>
        )}
      </div>
      <div aria-live="polite" className="mt-2 min-h-5 text-xs text-[var(--rl-fg-dim)]">
        {copyStatus === "copied" && "Diagnostic copié."}
        {copyStatus === "failed" && "Copie refusée par le navigateur : utilise le téléchargement."}
      </div>
    </section>
  );
}
