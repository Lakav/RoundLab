import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteStoredMatch,
  listStoredMatches,
  readCompleteStoredMatch,
  readStoredMetadata,
  readStoredRound,
  renameStoredMatch,
  saveParsedMatch,
  saveStoredBenchmarkContribution,
} from "@/lib/backends/browser-store";
import {
  BROWSER_DB_VERSION,
  META_STORE,
  type BrowserStoreSchemaRecord,
} from "@/lib/backends/browser-store-migrations";
import { replayMatch, replayRound } from "./fixtures";

const DB_NAME = "roundlab-web";

function request<T>(value: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    value.onsuccess = () => resolve(value.result);
    value.onerror = () => reject(value.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

async function openDatabase(): Promise<IDBDatabase> {
  return request(indexedDB.open(DB_NAME, BROWSER_DB_VERSION));
}

async function openLegacyDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const opening = indexedDB.open(DB_NAME, 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore("matches", { keyPath: "id" });
      const rounds = db.createObjectStore("rounds", { keyPath: "key" });
      rounds.createIndex("matchId", "matchId", { unique: false });
    };
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => reject(opening.error);
  });
}

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const deletion = indexedDB.deleteDatabase(DB_NAME);
    deletion.onsuccess = () => resolve();
    deletion.onerror = () => reject(deletion.error);
    deletion.onblocked = () => reject(new Error("test database deletion was blocked"));
  });
}

describe("IndexedDB match store", () => {
  beforeEach(async () => {
    vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    await deleteDatabase();
  });

  it("migrates a version 1 database without losing stored matches or rounds", async () => {
    const legacy = replayMatch();
    const metadata = {
      ...legacy,
      rounds: legacy.rounds.map((round) => ({
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
      })),
    };
    const db = await openLegacyDatabase();
    const tx = db.transaction(["matches", "rounds"], "readwrite");
    tx.objectStore("matches").put({
      id: "legacy-match",
      name: "Legacy demo",
      createdAt: 123,
      size: 456,
      metadata,
    });
    tx.objectStore("rounds").put({
      key: "legacy-match:1",
      matchId: "legacy-match",
      number: 1,
      round: legacy.rounds[0],
    });
    await transactionDone(tx);
    db.close();

    expect(await listStoredMatches()).toEqual([
      { id: "legacy-match", name: "Legacy demo", createdAt: 123, size: 456 },
    ]);
    expect(await readStoredMetadata("legacy-match")).toEqual(metadata);
    expect(await readStoredRound("legacy-match", 1)).toEqual(legacy.rounds[0]);

    const upgraded = await openDatabase();
    expect(upgraded.version).toBe(BROWSER_DB_VERSION);
    expect([...upgraded.objectStoreNames]).toContain(META_STORE);
    const schemaTx = upgraded.transaction(META_STORE, "readonly");
    const schema = await request(
      schemaTx.objectStore(META_STORE).get("schema") as IDBRequest<BrowserStoreSchemaRecord>,
    );
    expect(schema).toEqual({ key: "schema", version: BROWSER_DB_VERSION });
    upgraded.close();
  });

  it("stores lightweight metadata and round payloads separately", async () => {
    const losslessId = "76561198073049527";
    const parsed = replayMatch([
      {
        ...replayRound(1),
        frames: [{
          t: 0,
          players: [{ id: losslessId, x: 10, y: 20, z: 30, yaw: 90, hp: 100, armor: 100, team: 2 }],
        }],
        damages: [{
          t: 1,
          tick: 64,
          attacker: losslessId,
          victim: "76561198073049528",
          weapon: "ak47",
          damageHealth: 27,
          damageArmor: 4,
          healthAfter: 73,
          armorAfter: 96,
          hitgroup: "chest",
        }],
        bulletImpacts: [{
          t: 1.05,
          tick: 67,
          sequence: 2,
          shooter: losslessId,
          x: 120,
          y: -45,
          z: 72,
        }],
        flashes: [{
          t: 1.1,
          tick: 70,
          sequence: 3,
          thrower: losslessId,
          victim: "76561198073049528",
          duration: 2.75,
        }],
        purchases: [{
          t: 0,
          tick: 32,
          sequence: 1,
          player: losslessId,
          item: "AK-47",
          cost: 2_700,
          inventorySlot: 1,
          wasSold: false,
        }],
      },
      replayRound(2),
    ]);
    const match = {
      ...parsed,
      schemaVersion: "roundlab.replay.v2" as const,
      players: [{ steamId: losslessId, name: "Player One", team: "T" as const }],
    };
    const summary = await saveParsedMatch("match-1", "  Demo one  ", 42, match);

    expect(summary).toEqual({
      id: "match-1",
      name: "Demo one",
      createdAt: 1_700_000_000_000,
      size: 42,
    });
    expect(await listStoredMatches()).toEqual([summary]);

    const metadata = await readStoredMetadata("match-1");
    expect(metadata.rounds).toHaveLength(2);
    for (const round of metadata.rounds) {
      expect(round).toMatchObject({
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
      });
    }
    expect(await readStoredRound("match-1", 1)).toEqual(match.rounds[0]);
    expect((await readStoredRound("match-1", 1)).bulletImpacts?.[0]).toMatchObject({
      shooter: losslessId,
      tick: 67,
      x: 120,
      y: -45,
      z: 72,
    });
    expect((await readStoredRound("match-1", 1)).flashes?.[0]).toMatchObject({
      thrower: losslessId,
      victim: "76561198073049528",
      tick: 70,
      duration: 2.75,
    });
    expect((await readStoredRound("match-1", 1)).purchases?.[0]).toMatchObject({
      player: losslessId,
      item: "AK-47",
      cost: 2_700,
      inventorySlot: 1,
      wasSold: false,
    });
    expect(await readCompleteStoredMatch("match-1")).toEqual(match);
  });

  it("persists normalized benchmark contribution settings", async () => {
    await saveParsedMatch("match-1", "Demo", 1, replayMatch());
    const updated = await saveStoredBenchmarkContribution("match-1", {
      selectedPlayerId: " 1 ",
      contributorId: " contributor-1 ",
      level: "faceit-level-8",
      levelSource: "self_reported_faceit",
      playedAt: "2026-07-26T20:00:00+02:00",
      consentedAt: "2026-07-27T12:00:00Z",
    });

    expect(updated.benchmarkContribution).toEqual({
      selectedPlayerId: "1",
      contributorId: "contributor-1",
      level: "faceit-level-8",
      levelSource: "self_reported_faceit",
      playedAt: "2026-07-26T18:00:00.000Z",
      consentedAt: "2026-07-27T12:00:00.000Z",
    });
    expect((await listStoredMatches())[0].benchmarkContribution)
      .toEqual(updated.benchmarkContribution);
    await expect(saveStoredBenchmarkContribution("match-1", {
      ...updated.benchmarkContribution!,
      level: "faceit-level-99",
    })).rejects.toThrow("settings are invalid");
  });

  it("renames, replaces and deletes a complete match atomically", async () => {
    await saveParsedMatch("match-1", "Initial", 10, replayMatch());
    expect((await renameStoredMatch("match-1", "  Renamed  ")).name).toBe("Renamed");
    expect((await renameStoredMatch("match-1", "   ")).name).toBe("Renamed");

    await saveParsedMatch("match-1", "Replacement", Number.NaN, replayMatch([replayRound(7)]));
    expect((await listStoredMatches())[0]).toMatchObject({ name: "Replacement", size: 0 });
    await expect(readStoredRound("match-1", 1)).rejects.toThrow("Round not found: 1");
    expect((await readStoredRound("match-1", 7)).number).toBe(7);

    await deleteStoredMatch("match-1");
    expect(await listStoredMatches()).toEqual([]);
    await expect(readStoredMetadata("match-1")).rejects.toThrow("Match not found");
    await expect(readStoredRound("match-1", 7)).rejects.toThrow("Round not found");
  });

  it("rejects malformed parser output before opening a transaction", async () => {
    await expect(saveParsedMatch("x", "x", 1, replayMatch([]))).rejects.toThrow("without playable rounds");
    await expect(saveParsedMatch("x", "x", 1, replayMatch([{ ...replayRound(1), number: 1.5 }]))).rejects.toThrow(
      "integer round number",
    );
    await expect(saveParsedMatch("x", "x", 1, replayMatch([replayRound(1), replayRound(1)]))).rejects.toThrow(
      "duplicate round number 1",
    );
    await expect(saveParsedMatch("x", "x", 1, replayMatch([{ ...replayRound(1), frames: [] }]))).rejects.toThrow(
      "without frame data",
    );
  });

  it("rejects corrupted stored round keys and empty payloads", async () => {
    await saveParsedMatch("match-1", "Demo", 1, replayMatch());
    const db = await openDatabase();
    const tx = db.transaction("rounds", "readwrite");
    tx.objectStore("rounds").put({
      key: "match-1:1",
      matchId: "other-match",
      number: 1,
      round: replayRound(1),
    });
    await transactionDone(tx);
    db.close();
    await expect(readStoredRound("match-1", 1)).rejects.toThrow("does not match its IndexedDB key");

    const db2 = await openDatabase();
    const tx2 = db2.transaction("rounds", "readwrite");
    tx2.objectStore("rounds").put({
      key: "match-1:2",
      matchId: "match-1",
      number: 2,
      round: { ...replayRound(2), frames: [] },
    });
    await transactionDone(tx2);
    db2.close();
    await expect(readStoredRound("match-1", 2)).rejects.toThrow("has no frame data");
  });

  it("rejects heavy or structurally invalid metadata on read", async () => {
    await saveParsedMatch("match-1", "Demo", 1, replayMatch());
    const db = await openDatabase();
    const tx = db.transaction("matches", "readwrite");
    tx.objectStore("matches").put({
      id: "match-1",
      name: "Demo",
      createdAt: 1,
      size: 1,
      metadata: replayMatch(),
    });
    await transactionDone(tx);
    db.close();
    await expect(readStoredMetadata("match-1")).rejects.toThrow("contains full round payloads");

    const db2 = await openDatabase();
    const tx2 = db2.transaction("matches", "readwrite");
    const malformed = replayMatch([{ ...replayRound(1), frames: undefined as never }]);
    tx2.objectStore("matches").put({ id: "match-1", name: "Demo", createdAt: 1, size: 1, metadata: malformed });
    await transactionDone(tx2);
    db2.close();
    await expect(readStoredMetadata("match-1")).resolves.toMatchObject({ rounds: [{ frames: [] }] });
  });

  it("normalizes legacy summaries and ignores entries without an id", async () => {
    await saveParsedMatch("seed", "Seed", 1, replayMatch());
    const db = await openDatabase();
    const tx = db.transaction("matches", "readwrite");
    const store = tx.objectStore("matches");
    store.put({ id: "legacy", name: " ", createdAt: -5, size: -10, metadata: replayMatch() });
    store.put({ id: "", name: "invalid", createdAt: 2, size: 2, metadata: replayMatch() });
    await transactionDone(tx);
    db.close();

    expect(await listStoredMatches()).toEqual([
      { id: "seed", name: "Seed", createdAt: 1_700_000_000_000, size: 1 },
      { id: "legacy", name: "legacy", createdAt: 0, size: 0 },
    ]);
  });

  it("reports missing rename targets", async () => {
    await saveParsedMatch("seed", "Seed", 1, replayMatch());
    await expect(renameStoredMatch("missing", "Name")).rejects.toThrow("Match not found: missing");
  });
});
