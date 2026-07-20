import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  deleteStoredMatch,
  listStoredMatches,
  readStoredMetadata,
  readStoredRound,
  renameStoredMatch,
  saveParsedMatch,
} from "@/lib/backends/browser-store";
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
  return request(indexedDB.open(DB_NAME, 1));
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

  it("stores lightweight metadata and round payloads separately", async () => {
    const match = replayMatch();
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
      expect(round).toMatchObject({ frames: [], events: [], effects: [], weaponFires: [], projectileFrames: [] });
    }
    expect(await readStoredRound("match-1", 1)).toEqual(match.rounds[0]);
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
