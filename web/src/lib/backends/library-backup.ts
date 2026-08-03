import type { MatchSummary } from "@/lib/api";
import type { MatchData } from "@/lib/types";

export const LIBRARY_BACKUP_SCHEMA = "roundlab.library-backup.v1" as const;

export type LibraryBackupEntry = {
  summary: MatchSummary;
  data: MatchData;
};

export type LibraryBackup = {
  schema: typeof LIBRARY_BACKUP_SCHEMA;
  exportedAt: string;
  matches: LibraryBackupEntry[];
};

export type BackupCollisionPolicy = "fail" | "skip" | "duplicate" | "replace";

export type RestoreLibraryResult = {
  restored: MatchSummary[];
  skippedIds: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function assertSummary(value: unknown, index: number): asserts value is MatchSummary {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id.trim()) {
    throw new Error(`La sauvegarde contient un identifiant invalide à l’entrée ${index + 1}.`);
  }
  if (typeof value.name !== "string" || !value.name.trim()) {
    throw new Error(`La sauvegarde contient un nom invalide à l’entrée ${index + 1}.`);
  }
  if (typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) || value.createdAt < 0) {
    throw new Error(`La sauvegarde contient une date invalide à l’entrée ${index + 1}.`);
  }
  if (typeof value.size !== "number" || !Number.isFinite(value.size) || value.size < 0) {
    throw new Error(`La sauvegarde contient une taille invalide à l’entrée ${index + 1}.`);
  }
}

function assertMatchData(value: unknown, index: number): asserts value is MatchData {
  if (!isRecord(value) || !Array.isArray(value.rounds) || value.rounds.length === 0) {
    throw new Error(`La sauvegarde ne contient aucune manche exploitable à l’entrée ${index + 1}.`);
  }
  const roundNumbers = new Set<number>();
  for (const round of value.rounds) {
    if (!isRecord(round) || !Number.isInteger(round.number) || !Array.isArray(round.frames) || round.frames.length === 0) {
      throw new Error(`La sauvegarde contient une manche incomplète à l’entrée ${index + 1}.`);
    }
    const number = round.number as number;
    if (roundNumbers.has(number)) {
      throw new Error(`La sauvegarde contient deux fois la manche ${number} à l’entrée ${index + 1}.`);
    }
    roundNumbers.add(number);
  }
}

export function assertLibraryBackup(value: unknown): asserts value is LibraryBackup {
  if (!isRecord(value) || value.schema !== LIBRARY_BACKUP_SCHEMA || !Array.isArray(value.matches)) {
    throw new Error("Ce fichier n’utilise pas un format de sauvegarde RoundLab compatible.");
  }
  if (typeof value.exportedAt !== "string" || Number.isNaN(Date.parse(value.exportedAt))) {
    throw new Error("La sauvegarde ne contient pas de date d’export valide.");
  }
  const ids = new Set<string>();
  value.matches.forEach((entry, index) => {
    if (!isRecord(entry)) throw new Error(`L’entrée ${index + 1} de la sauvegarde est invalide.`);
    assertSummary(entry.summary, index);
    assertMatchData(entry.data, index);
    if (ids.has(entry.summary.id)) {
      throw new Error(`La sauvegarde contient plusieurs matchs avec l’identifiant ${entry.summary.id}.`);
    }
    ids.add(entry.summary.id);
  });
}

export function parseLibraryBackup(text: string): LibraryBackup {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error("Ce fichier n’est pas une sauvegarde JSON valide.", { cause: error });
  }
  assertLibraryBackup(value);
  return value;
}

export class LibraryBackupConflictError extends Error {
  constructor(readonly conflictingIds: string[]) {
    super(`${conflictingIds.length} match(s) de la sauvegarde existent déjà.`);
    this.name = "LibraryBackupConflictError";
  }
}
