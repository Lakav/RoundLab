"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Database, Download, HardDrive, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  exportLibrary,
  getStorageStatus,
  requestStoragePersistence,
  restoreLibrary,
  type BackupCollisionPolicy,
  type LibraryBackup,
  type StorageStatus,
} from "@/lib/api";
import {
  LibraryBackupConflictError,
  parseLibraryBackup,
} from "@/lib/backends/library-backup";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "inconnue";
  const units = ["o", "Ko", "Mo", "Go"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

export async function downloadLibraryBackup(matchId?: string): Promise<void> {
  const backup = await exportLibrary(matchId);
  const blob = new Blob([JSON.stringify(backup)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = matchId
    ? `roundlab-match-${matchId}.roundlab.json`
    : `roundlab-library-${new Date().toISOString().slice(0, 10)}.roundlab.json`;
  link.click();
  URL.revokeObjectURL(url);
}

export function StoragePanel({
  matchCount,
  onLibraryChanged,
}: {
  matchCount: number;
  onLibraryChanged: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<StorageStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingBackup, setPendingBackup] = useState<LibraryBackup | null>(null);
  const [conflicts, setConflicts] = useState<string[]>([]);

  const refreshStatus = useCallback(async () => {
    setStatus(await getStorageStatus());
  }, []);

  useEffect(() => {
    let cancelled = false;
    void getStorageStatus()
      .then((next) => {
        if (!cancelled) setStatus(next);
      })
      .catch(() => {
        if (!cancelled) setStatus(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function persist(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const next = await requestStoragePersistence();
      setStatus(next);
      setMessage(next.persisted
        ? "Le navigateur a accordé le stockage persistant."
        : "Le navigateur n’a pas accordé la persistance. Garde une sauvegarde externe.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Impossible de demander la persistance.");
    } finally {
      setBusy(false);
    }
  }

  async function restore(backup: LibraryBackup, policy: BackupCollisionPolicy): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const result = await restoreLibrary(backup, policy);
      await onLibraryChanged();
      await refreshStatus();
      setPendingBackup(null);
      setConflicts([]);
      setMessage(`${result.restored.length} match(s) restauré(s)${result.skippedIds.length ? `, ${result.skippedIds.length} ignoré(s)` : ""}.`);
    } catch (cause) {
      if (cause instanceof LibraryBackupConflictError) {
        setPendingBackup(backup);
        setConflicts(cause.conflictingIds);
      } else {
        setError(cause instanceof Error ? cause.message : "La restauration a échoué.");
      }
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File): Promise<void> {
    setMessage(null);
    setError(null);
    try {
      const backup = parseLibraryBackup(await file.text());
      await restore(backup, "fail");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "La sauvegarde est illisible.");
    }
  }

  const persistenceLabel = !status?.supported
    ? "API de stockage indisponible"
    : status.persisted
      ? "Stockage persistant"
      : "Stockage révocable par le navigateur";

  return (
    <section className="rounded-xl border border-white/[0.08] bg-[#121514]/85 px-5 py-5 shadow-[0_18px_50px_rgba(0,0,0,0.16)]">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035]">
            <Database className="size-4 text-emerald-200/85" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Stockage local</h2>
            <p className="mt-1 text-xs text-neutral-400">{persistenceLabel}</p>
            {status && (
              <p className="mt-1 text-[11px] text-neutral-400">
                {formatBytes(status.usageBytes)} utilisés sur {formatBytes(status.quotaBytes)} disponibles
              </p>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {status?.supported && !status.persisted && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void persist()}>
              <HardDrive className="size-3.5" /> Protéger le stockage
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            disabled={busy || matchCount === 0}
            onClick={() => void downloadLibraryBackup().catch((cause) => setError(cause instanceof Error ? cause.message : "L’export a échoué."))}
          >
            <Download className="size-3.5" /> Exporter
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Upload className="size-3.5" /> Restaurer
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".json,.roundlab.json,application/json"
            className="sr-only"
            aria-label="Choisir une sauvegarde RoundLab"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void importFile(file);
            }}
          />
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-neutral-400">
        Les données restent sur cet appareil. Une sauvegarde est créée en mémoire avant le téléchargement ; pour une grosse bibliothèque, exporte plutôt les matchs un par un.
      </p>
      {message && <p role="status" className="mt-3 text-xs text-emerald-200">{message}</p>}
      {error && <p role="alert" className="mt-3 text-xs text-red-200">{error}</p>}
      {pendingBackup && (
        <div role="dialog" aria-label="Conflits de restauration" className="mt-4 rounded-lg border border-amber-200/20 bg-amber-100/[0.04] p-4">
          <p className="text-xs font-semibold text-amber-100">{conflicts.length} match(s) existent déjà.</p>
          <p className="mt-1 text-[11px] leading-5 text-neutral-400">Choisis explicitement quoi faire. Aucun match n’a encore été écrit.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void restore(pendingBackup, "duplicate")}>Dupliquer</Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void restore(pendingBackup, "skip")}>Ignorer les conflits</Button>
            <Button size="sm" className="bg-red-500/20 text-red-100 hover:bg-red-500/30" disabled={busy} onClick={() => void restore(pendingBackup, "replace")}>Remplacer</Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setPendingBackup(null); setConflicts([]); }}>Annuler</Button>
          </div>
        </div>
      )}
    </section>
  );
}
