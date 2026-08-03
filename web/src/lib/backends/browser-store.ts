import type { MatchSummary } from "@/lib/api";
import type { MatchData, Round } from "@/lib/types";
import {
  normalizeBenchmarkContributionSettings,
  type BenchmarkContributionSettings,
} from "@/lib/analysis/benchmark-contribution";
import {
  BROWSER_DB_VERSION,
  MATCH_STORE,
  ROUND_STORE,
  runBrowserStoreMigrations,
} from "@/lib/backends/browser-store-migrations";
import {
  LIBRARY_BACKUP_SCHEMA,
  LibraryBackupConflictError,
  assertLibraryBackup,
  type BackupCollisionPolicy,
  type LibraryBackup,
  type RestoreLibraryResult,
} from "@/lib/backends/library-backup";
import { actionableStorageError } from "@/lib/storage-safety";

const DB_NAME = "roundlab-web";

type StoredMatch = MatchSummary & {
  metadata: MatchData;
  benchmarkContribution?: BenchmarkContributionSettings;
};

type StoredRound = {
  key: string;
  matchId: string;
  number: number;
  round: Round;
};

function roundKey(matchId: string, number: number): string {
  return `${matchId}:${number}`;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, BROWSER_DB_VERSION);
    req.onupgradeneeded = (event) => {
      runBrowserStoreMigrations(
        req.result,
        req.transaction!,
        event.oldVersion,
        event.newVersion,
      );
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onblocked = () => reject(new Error("La base locale est ouverte dans un autre onglet. Ferme les autres onglets RoundLab puis réessaie."));
    req.onerror = () => reject(req.error ?? new Error("IndexedDB open failed"));
  });
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function requestResult<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function requestResultWithTransactionWork<T>(req: IDBRequest<T>, work: (result: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      try {
        work(req.result);
        resolve(req.result);
      } catch (error) {
        reject(error);
      }
    };
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

function deleteStoredRoundsForMatches(store: IDBObjectStore, matchIds: Set<string>): Promise<void> {
  if (matchIds.size === 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve();
        return;
      }
      const item = cursor.value as StoredRound;
      if (matchIds.has(item.matchId)) cursor.delete();
      cursor.continue();
    };
    request.onerror = () => reject(request.error ?? new Error("IndexedDB cursor failed"));
  });
}

function stripRoundPayload(round: Round): Round {
  return {
    ...round,
    frames: [],
    events: [],
    damages: [],
    disconnects: [],
    flashes: [],
    purchases: [],
    effects: [],
    weaponFires: [],
    bulletImpacts: [],
    projectileFrames: [],
  };
}

function assertStorableMatch(data: MatchData): void {
  if (!Array.isArray(data.rounds) || data.rounds.length === 0) {
    throw new Error("Cannot store a match without playable rounds.");
  }
  const seenRoundNumbers = new Set<number>();
  for (const round of data.rounds) {
    if (!Number.isInteger(round.number)) {
      throw new Error("Cannot store a round without an integer round number.");
    }
    if (seenRoundNumbers.has(round.number)) {
      throw new Error(`Cannot store duplicate round number ${round.number}.`);
    }
    seenRoundNumbers.add(round.number);
    if (!Array.isArray(round.frames) || round.frames.length === 0) {
      throw new Error(`Cannot store round ${round.number} without frame data.`);
    }
  }
}

function assertReadableStoredRound(matchId: string, number: number, item: StoredRound): Round {
  if (item.matchId !== matchId || item.number !== number || item.round.number !== number) {
    throw new Error(`Stored round ${number} does not match its IndexedDB key.`);
  }
  if (!Array.isArray(item.round.frames) || item.round.frames.length === 0) {
    throw new Error(`Stored round ${number} has no frame data.`);
  }
  return item.round;
}

function metadataPayloadLength(id: string, roundNumber: number, field: string, value: unknown): number {
  if (value === undefined || value === null) return 0;
  if (!Array.isArray(value)) {
    throw new Error(`Stored match ${id} round ${roundNumber} metadata field ${field} is not an array.`);
  }
  return value.length;
}

function normalizeMatchName(name: unknown, fallback: string): string {
  return typeof name === "string" && name.trim() ? name.trim() : fallback;
}

function normalizeMatchSize(size: unknown): number {
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : 0;
}

function normalizeMatchCreatedAt(createdAt: unknown): number {
  return typeof createdAt === "number" && Number.isFinite(createdAt) && createdAt > 0 ? createdAt : 0;
}

function storedMatchSummary(item: StoredMatch): MatchSummary | null {
  if (typeof item.id !== "string" || !item.id) return null;
  const benchmarkContribution = normalizeBenchmarkContributionSettings(
    item.benchmarkContribution,
  );
  return {
    id: item.id,
    name: normalizeMatchName(item.name, item.id.slice(0, 8)),
    createdAt: normalizeMatchCreatedAt(item.createdAt),
    size: normalizeMatchSize(item.size),
    ...(benchmarkContribution ? { benchmarkContribution } : {}),
  };
}

function assertLightweightMetadata(id: string, metadata: MatchData): MatchData {
  if (!Array.isArray(metadata.rounds) || metadata.rounds.length === 0) {
    throw new Error(`Stored match ${id} has no round metadata.`);
  }
  const seenRoundNumbers = new Set<number>();
  for (const round of metadata.rounds) {
    if (!Number.isInteger(round.number)) {
      throw new Error(`Stored match ${id} has round metadata without an integer round number.`);
    }
    if (seenRoundNumbers.has(round.number)) {
      throw new Error(`Stored match ${id} has duplicate round metadata ${round.number}.`);
    }
    seenRoundNumbers.add(round.number);
    const frames = metadataPayloadLength(id, round.number, "frames", round.frames);
    const events = metadataPayloadLength(id, round.number, "events", round.events);
    const damages = metadataPayloadLength(id, round.number, "damages", round.damages);
    const disconnects = metadataPayloadLength(id, round.number, "disconnects", round.disconnects);
    const flashes = metadataPayloadLength(id, round.number, "flashes", round.flashes);
    const purchases = metadataPayloadLength(id, round.number, "purchases", round.purchases);
    const effects = metadataPayloadLength(id, round.number, "effects", round.effects);
    const weaponFires = metadataPayloadLength(id, round.number, "weaponFires", round.weaponFires);
    const bulletImpacts = metadataPayloadLength(id, round.number, "bulletImpacts", round.bulletImpacts);
    const projectileFrames = metadataPayloadLength(id, round.number, "projectileFrames", round.projectileFrames);
    const hasPayload =
      frames > 0 ||
      events > 0 ||
      damages > 0 ||
      disconnects > 0 ||
      flashes > 0 ||
      purchases > 0 ||
      effects > 0 ||
      weaponFires > 0 ||
      bulletImpacts > 0 ||
      projectileFrames > 0;
    if (hasPayload) {
      throw new Error(`Stored match ${id} metadata contains full round payloads. Re-import the demo.`);
    }
  }
  return {
    ...metadata,
    rounds: metadata.rounds.map(stripRoundPayload),
  };
}

export async function listStoredMatches(): Promise<MatchSummary[]> {
  const db = await openDb();
  try {
    const tx = db.transaction(MATCH_STORE, "readonly");
    const matches = await requestResult<StoredMatch[]>(
      tx.objectStore(MATCH_STORE).getAll() as IDBRequest<StoredMatch[]>,
    );
    return matches
      .map(storedMatchSummary)
      .filter((item): item is MatchSummary => Boolean(item))
      .sort((a, b) => b.createdAt - a.createdAt);
  } finally {
    db.close();
  }
}
export async function readStoredMetadata(id: string): Promise<MatchData> {
  const db = await openDb();
  try {
    const tx = db.transaction(MATCH_STORE, "readonly");
    const item = await requestResult<StoredMatch | undefined>(
      tx.objectStore(MATCH_STORE).get(id) as IDBRequest<StoredMatch | undefined>,
    );
    if (!item) throw new Error(`Match not found: ${id}`);
    return assertLightweightMetadata(id, item.metadata);
  } finally {
    db.close();
  }
}

export async function readCompleteStoredMatch(id: string): Promise<MatchData> {
  const metadata = await readStoredMetadata(id);
  const rounds = await Promise.all(
    metadata.rounds.map((round) => readStoredRound(id, round.number)),
  );
  return { ...metadata, rounds };
}

export async function createLibraryBackup(matchId?: string): Promise<LibraryBackup> {
  const summaries = await listStoredMatches();
  const selected = matchId ? summaries.filter((summary) => summary.id === matchId) : summaries;
  if (matchId && selected.length === 0) throw new Error(`Match not found: ${matchId}`);
  const matches = [];
  for (const summary of selected) {
    matches.push({ summary, data: await readCompleteStoredMatch(summary.id) });
  }
  return { schema: LIBRARY_BACKUP_SCHEMA, exportedAt: new Date().toISOString(), matches };
}

function duplicateId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Ce navigateur ne sait pas générer un identifiant sûr pour dupliquer le match.");
  }
  return globalThis.crypto.randomUUID();
}

export async function restoreLibraryBackup(
  backup: LibraryBackup,
  collisionPolicy: BackupCollisionPolicy = "fail",
): Promise<RestoreLibraryResult> {
  assertLibraryBackup(backup);
  for (const entry of backup.matches) assertStorableMatch(entry.data);
  const existing = new Set((await listStoredMatches()).map((match) => match.id));
  const conflicts = backup.matches.filter((entry) => existing.has(entry.summary.id)).map((entry) => entry.summary.id);
  if (conflicts.length > 0 && collisionPolicy === "fail") throw new LibraryBackupConflictError(conflicts);

  const skippedIds: string[] = [];
  const prepared = backup.matches.flatMap((entry) => {
    const conflictsWithExisting = existing.has(entry.summary.id);
    if (conflictsWithExisting && collisionPolicy === "skip") {
      skippedIds.push(entry.summary.id);
      return [];
    }
    if (conflictsWithExisting && collisionPolicy === "duplicate") {
      const id = duplicateId();
      return [{ ...entry, summary: { ...entry.summary, id, name: `${entry.summary.name} (restauré)` } }];
    }
    return [entry];
  });
  if (prepared.length === 0) return { restored: [], skippedIds };

  const db = await openDb();
  try {
    const tx = db.transaction([MATCH_STORE, ROUND_STORE], "readwrite");
    const matchStore = tx.objectStore(MATCH_STORE);
    const roundStore = tx.objectStore(ROUND_STORE);
    const replacedIds = new Set(
      collisionPolicy === "replace" ? conflicts : [],
    );
    await deleteStoredRoundsForMatches(roundStore, replacedIds);
    for (const entry of prepared) {
      const metadata: MatchData = { ...entry.data, rounds: entry.data.rounds.map(stripRoundPayload) };
      matchStore.put({ ...entry.summary, metadata } satisfies StoredMatch);
      for (const round of entry.data.rounds) {
        roundStore.put({
          key: roundKey(entry.summary.id, round.number),
          matchId: entry.summary.id,
          number: round.number,
          round,
        } satisfies StoredRound);
      }
    }
    await txDone(tx);
    return { restored: prepared.map((entry) => entry.summary), skippedIds };
  } catch (error) {
    throw actionableStorageError(error);
  } finally {
    db.close();
  }
}

export async function readStoredRound(matchId: string, number: number): Promise<Round> {
  const db = await openDb();
  try {
    const tx = db.transaction(ROUND_STORE, "readonly");
    const item = await requestResult<StoredRound | undefined>(
      tx.objectStore(ROUND_STORE).get(roundKey(matchId, number)) as IDBRequest<StoredRound | undefined>,
    );
    if (!item) throw new Error(`Round not found: ${number}`);
    return assertReadableStoredRound(matchId, number, item);
  } finally {
    db.close();
  }
}

export async function deleteStoredMatch(id: string): Promise<void> {
  const db = await openDb();
  try {
    const tx = db.transaction([MATCH_STORE, ROUND_STORE], "readwrite");
    tx.objectStore(MATCH_STORE).delete(id);
    const rounds = tx.objectStore(ROUND_STORE);
    await requestResultWithTransactionWork<IDBValidKey[]>(
      rounds.index("matchId").getAllKeys(id),
      (keys) => {
        for (const key of keys) rounds.delete(key);
      },
    );
    await txDone(tx);
  } finally {
    db.close();
  }
}

export async function renameStoredMatch(id: string, name: string): Promise<MatchSummary> {
  const db = await openDb();
  try {
    const tx = db.transaction(MATCH_STORE, "readwrite");
    const store = tx.objectStore(MATCH_STORE);
    let summary: MatchSummary | null = null;
    await requestResultWithTransactionWork<StoredMatch | undefined>(
      store.get(id) as IDBRequest<StoredMatch | undefined>,
      (item) => {
        if (!item) throw new Error(`Match not found: ${id}`);
        const updated = { ...item, name: normalizeMatchName(name, item.name) };
        store.put(updated);
        summary = storedMatchSummary(updated) ?? { id: updated.id, name: updated.name, createdAt: updated.createdAt, size: updated.size };
      },
    );
    await txDone(tx);
    if (!summary) throw new Error(`Match not found: ${id}`);
    return summary;
  } finally {
    db.close();
  }
}

export async function saveStoredBenchmarkContribution(
  id: string,
  settings: BenchmarkContributionSettings,
): Promise<MatchSummary> {
  const normalized = normalizeBenchmarkContributionSettings(settings);
  if (!normalized) {
    throw new Error("Benchmark contribution settings are invalid.");
  }
  const db = await openDb();
  try {
    const tx = db.transaction(MATCH_STORE, "readwrite");
    const store = tx.objectStore(MATCH_STORE);
    let summary: MatchSummary | null = null;
    await requestResultWithTransactionWork<StoredMatch | undefined>(
      store.get(id) as IDBRequest<StoredMatch | undefined>,
      (item) => {
        if (!item) throw new Error(`Match not found: ${id}`);
        const updated = { ...item, benchmarkContribution: normalized };
        store.put(updated);
        summary = storedMatchSummary(updated);
      },
    );
    await txDone(tx);
    if (!summary) throw new Error(`Match not found: ${id}`);
    return summary;
  } finally {
    db.close();
  }
}

export async function saveParsedMatch(id: string, name: string, size: number, data: MatchData): Promise<MatchSummary> {
  assertStorableMatch(data);
  const db = await openDb();
  const summary: MatchSummary = {
    id,
    name: normalizeMatchName(name, id.slice(0, 8)),
    createdAt: Date.now(),
    size: normalizeMatchSize(size),
  };
  const metadata: MatchData = {
    ...data,
    rounds: data.rounds.map(stripRoundPayload),
  };
  try {
    const tx = db.transaction([MATCH_STORE, ROUND_STORE], "readwrite");
    const rounds = tx.objectStore(ROUND_STORE);
    await requestResultWithTransactionWork<IDBValidKey[]>(
      rounds.index("matchId").getAllKeys(id),
      (existingKeys) => {
        for (const key of existingKeys) rounds.delete(key);
        tx.objectStore(MATCH_STORE).put({ ...summary, metadata });
        for (const round of data.rounds) {
          rounds.put({
            key: roundKey(id, round.number),
            matchId: id,
            number: round.number,
            round,
          } satisfies StoredRound);
        }
      },
    );
    await txDone(tx);
    return summary;
  } catch (error) {
    throw actionableStorageError(error);
  } finally {
    db.close();
  }
}
