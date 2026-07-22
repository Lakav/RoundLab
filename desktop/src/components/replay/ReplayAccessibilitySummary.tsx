"use client";

import { useReplay } from "@/lib/replay-store";
import type { Frame, MatchEvent, PlayerPos } from "@/lib/types";

function frameAtOrBefore(frames: Frame[], time: number): Frame | null {
  if (!frames.length) return null;
  let selected = frames[0];
  for (const frame of frames) {
    if (frame.t > time) break;
    selected = frame;
  }
  return selected;
}

function playerName(id: number, players: Array<{ steamId: number; name: string }>): string {
  return players.find((player) => player.steamId === id)?.name || `Player ${id}`;
}

function describeEvent(event: MatchEvent, players: Array<{ steamId: number; name: string }>): string {
  const at = `${event.t.toFixed(1)} seconds`;
  if (event.type === "kill") {
    const details = [
      event.assist && `assisted by ${playerName(event.assist, players)}${event.flashAssist ? " with a flashbang" : ""}`,
      event.attackerBlind && "while blinded",
      event.noScope && "no-scope",
      event.throughSmoke && "through smoke",
      Boolean(event.penetrated) && `through ${event.penetrated} surface${event.penetrated === 1 ? "" : "s"}`,
      event.hs && "headshot",
      event.dominated && "domination",
      event.revenge && "revenge",
    ].filter(Boolean);
    return `${at}: ${playerName(event.killer ?? 0, players)} eliminated ${playerName(event.victim ?? 0, players)}${event.weapon ? ` with ${event.weapon}` : ""}${details.length ? `, ${details.join(", ")}` : ""}.`;
  }
  if (event.type === "bomb_planted") return `${at}: bomb planted.`;
  if (event.type === "bomb_defuse_start") return `${at}: bomb defuse started.`;
  if (event.type === "bomb_defuse_abort") return `${at}: bomb defuse interrupted.`;
  if (event.type === "bomb_defused") return `${at}: bomb defused.`;
  if (event.type === "bomb_exploded") return `${at}: bomb exploded.`;
  return `${at}: round ended${event.winner ? `, winner ${event.winner}` : ""}.`;
}

function describePlayer(player: PlayerPos, players: Array<{ steamId: number; name: string }>): string {
  const side = player.team === 3 ? "Counter-Terrorist" : player.team === 2 ? "Terrorist" : "spectator";
  const state = player.hp > 0 ? `${player.hp} health` : "eliminated";
  return `${playerName(player.id, players)}, ${side}, ${state}, position ${Math.round(player.x)}, ${Math.round(player.y)}, altitude ${Math.round(player.z)}.`;
}

export function ReplayAccessibilitySummary({ id = "replay-text-alternative" }: { id?: string }) {
  const match = useReplay((state) => state.match);
  const currentRoundIdx = useReplay((state) => state.currentRoundIdx);
  const time = useReplay((state) => state.time);
  if (!match) return null;
  const round = match.rounds[currentRoundIdx];
  if (!round) return null;
  const frame = frameAtOrBefore(round.frames, time);
  const recentEvents = round.events.filter((event) => event.t <= time).slice(-5);

  return (
    <section id={id} className="sr-only" aria-label="Text alternative for the replay radar">
      <h2>Replay text alternative</h2>
      <p>
        Map {match.meta.map}. Round {round.number} of {match.rounds.length}. Time {time.toFixed(1)} seconds.
        Winner {round.winnerName || round.winner}.
      </p>
      {frame?.bomb && (
        <p>
          Bomb {frame.bomb.status} at position {Math.round(frame.bomb.x)}, {Math.round(frame.bomb.y)}, altitude {Math.round(frame.bomb.z)}.
        </p>
      )}
      <h3>Players at the current time</h3>
      <ul>
        {(frame?.players ?? []).map((player) => <li key={player.id}>{describePlayer(player, match.players)}</li>)}
      </ul>
      <h3>Latest events</h3>
      {recentEvents.length ? (
        <ol>{recentEvents.map((event, index) => <li key={`${event.type}-${event.t}-${index}`}>{describeEvent(event, match.players)}</li>)}</ol>
      ) : (
        <p>No event has occurred yet in this round.</p>
      )}
    </section>
  );
}
