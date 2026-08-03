import { describe, expect, it } from "vitest";
import { LIBRARY_BACKUP_SCHEMA, parseLibraryBackup } from "@/lib/backends/library-backup";
import { replayMatch } from "./fixtures";

function validBackup() {
  return {
    schema: LIBRARY_BACKUP_SCHEMA,
    exportedAt: "2026-08-03T10:00:00.000Z",
    matches: [{
      summary: { id: "match-1", name: "Demo", createdAt: 1, size: 2 },
      data: replayMatch(),
    }],
  };
}

describe("library backup format", () => {
  it("parses a complete versioned backup", () => {
    expect(parseLibraryBackup(JSON.stringify(validBackup()))).toEqual(validBackup());
  });

  it("rejects invalid JSON, schemas, duplicate ids and incomplete rounds", () => {
    expect(() => parseLibraryBackup("{")) .toThrow("JSON valide");
    expect(() => parseLibraryBackup(JSON.stringify({ ...validBackup(), schema: "future" }))).toThrow("format");
    const duplicate = validBackup();
    duplicate.matches.push(duplicate.matches[0]);
    expect(() => parseLibraryBackup(JSON.stringify(duplicate))).toThrow("plusieurs matchs");
    const incomplete = validBackup();
    incomplete.matches[0].data = replayMatch([{ ...replayMatch().rounds[0], frames: [] }]);
    expect(() => parseLibraryBackup(JSON.stringify(incomplete))).toThrow("manche incomplète");
  });
});
