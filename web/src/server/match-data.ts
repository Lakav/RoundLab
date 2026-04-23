import { readFile, stat } from "fs/promises";
import { gunzip, gzip } from "zlib";
import { promisify } from "util";
import path from "path";
import type { MatchData, Round } from "@/lib/types";

const gunzipAsync = promisify(gunzip);
const gzipAsync = promisify(gzip);

type CacheEntry = {
  mtimeMs: number;
  data: MatchData;
};

const cache = new Map<string, CacheEntry>();
const roundGzipCache = new Map<string, { mtimeMs: number; body: Buffer }>();

export function isValidMatchId(id: string) {
  return /^[a-f0-9-]{36}$/.test(id);
}

function parsedPath(id: string) {
  return path.join(process.cwd(), "data", "parsed", `${id}.json.gz`);
}

export async function readMatchData(id: string): Promise<MatchData> {
  const file = parsedPath(id);
  const info = await stat(file);
  const cached = cache.get(id);
  if (cached && cached.mtimeMs === info.mtimeMs) return cached.data;

  const compressed = await readFile(file);
  const raw = await gunzipAsync(compressed);
  const data = JSON.parse(raw.toString("utf8")) as MatchData;
  cache.set(id, { mtimeMs: info.mtimeMs, data });
  return data;
}

export function toMatchMetadata(data: MatchData): MatchData {
  return {
    meta: data.meta,
    players: data.players,
    rounds: data.rounds.map((round) => ({
      number: round.number,
      startTick: round.startTick,
      freezeEndTick: round.freezeEndTick,
      endTick: round.endTick,
      duration: round.duration,
      winner: round.winner,
      winnerName: round.winnerName,
      scoreA: round.scoreA,
      scoreB: round.scoreB,
      frames: [],
      events: [],
      effects: [],
      weaponFires: [],
    })),
  };
}

export function findRound(data: MatchData, roundNumber: number): Round | undefined {
  return data.rounds.find((round) => round.number === roundNumber);
}

export async function gzipJsonForRound(id: string, round: Round): Promise<Buffer> {
  const file = parsedPath(id);
  const info = await stat(file);
  const key = `${id}:${round.number}`;
  const cached = roundGzipCache.get(key);
  if (cached && cached.mtimeMs === info.mtimeMs) return cached.body;

  const body = await gzipAsync(Buffer.from(JSON.stringify(round)));
  roundGzipCache.set(key, { mtimeMs: info.mtimeMs, body });
  return body;
}
