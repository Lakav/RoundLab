import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RoundLabBackend } from "@/lib/backends/types";

const backend: RoundLabBackend = {
  parser: {
    parseDemo: vi.fn().mockResolvedValue("parsed-id"),
    cancelParse: vi.fn().mockResolvedValue(undefined),
    onProgress: vi.fn().mockResolvedValue(() => undefined),
  },
  matches: {
    listMatches: vi.fn().mockResolvedValue([]),
    getMatchMetadata: vi.fn().mockResolvedValue({ meta: {}, players: [], rounds: [] }),
    getCompleteMatch: vi.fn().mockResolvedValue({ meta: {}, players: [], rounds: [] }),
    getRound: vi.fn().mockResolvedValue({ number: 1 }),
    deleteMatch: vi.fn().mockResolvedValue(undefined),
    renameMatch: vi.fn().mockResolvedValue({ id: "m", name: "New", createdAt: 1, size: 2 }),
    saveBenchmarkContribution: vi.fn().mockResolvedValue({
      id: "m",
      name: "New",
      createdAt: 1,
      size: 2,
    }),
  },
  diagnostics: {
    getDebugInfo: vi.fn().mockResolvedValue({ runtime: "test" }),
    writeDebugLog: vi.fn().mockResolvedValue(undefined),
  },
  shell: {
    enterMatchFullscreen: vi.fn().mockResolvedValue(undefined),
    exitMatchFullscreen: vi.fn().mockResolvedValue(undefined),
  },
};

vi.mock("@/lib/backends", () => ({ getBackend: () => backend }));

import {
  cancelParse,
  deleteMatch,
  enterMatchFullscreen,
  exitMatchFullscreen,
  getDebugInfo,
  getCompleteMatch,
  getMatchMetadata,
  getRound,
  listMatches,
  onParseProgress,
  parseDemo,
  renameMatch,
  saveBenchmarkContribution,
  writeDebugLog,
} from "@/lib/api";

describe("public browser API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates match reads and mutations to the selected backend", async () => {
    await listMatches();
    await getMatchMetadata("m");
    await getCompleteMatch("m");
    await getRound("m", 2, true);
    await deleteMatch("m");
    await renameMatch("m", "New");
    const contribution = {
      selectedPlayerId: "p1",
      contributorId: "c1",
      level: "faceit-level-10",
      levelSource: "self_reported_faceit" as const,
      playedAt: "2026-07-26T18:00:00.000Z",
      consentedAt: "2026-07-27T12:00:00.000Z",
    };
    await saveBenchmarkContribution("m", contribution);
    expect(backend.matches.listMatches).toHaveBeenCalledOnce();
    expect(backend.matches.getMatchMetadata).toHaveBeenCalledWith("m");
    expect(backend.matches.getCompleteMatch).toHaveBeenCalledWith("m");
    expect(backend.matches.getRound).toHaveBeenCalledWith("m", 2, true);
    expect(backend.matches.deleteMatch).toHaveBeenCalledWith("m");
    expect(backend.matches.renameMatch).toHaveBeenCalledWith("m", "New");
    expect(backend.matches.saveBenchmarkContribution)
      .toHaveBeenCalledWith("m", contribution);
  });

  it("delegates parser lifecycle calls", async () => {
    const file = { name: "demo.dem" } as File;
    const listener = vi.fn();
    await expect(parseDemo({ kind: "file", file })).resolves.toBe("parsed-id");
    await onParseProgress(listener);
    await cancelParse();
    expect(backend.parser.parseDemo).toHaveBeenCalledWith({ kind: "file", file });
    expect(backend.parser.onProgress).toHaveBeenCalledWith(listener);
    expect(backend.parser.cancelParse).toHaveBeenCalledOnce();
  });

  it("delegates diagnostics and fullscreen calls", async () => {
    await expect(getDebugInfo()).resolves.toEqual({ runtime: "test" });
    await writeDebugLog("source", "message");
    await enterMatchFullscreen();
    await exitMatchFullscreen();
    expect(backend.diagnostics.writeDebugLog).toHaveBeenCalledWith("source", "message");
    expect(backend.shell.enterMatchFullscreen).toHaveBeenCalledOnce();
    expect(backend.shell.exitMatchFullscreen).toHaveBeenCalledOnce();
  });
});
