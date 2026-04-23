"use client";

import { useReplay } from "@/lib/replay-store";
import { THEME } from "@/lib/theme";
import { iconPathFor } from "@/lib/icons";

const WINDOW_SECONDS = 6;

export function KillFeed() {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const time = useReplay((s) => s.time) ?? 0;
  if (!match) return null;
  const round = match.rounds[currentRoundIdx];
  if (!round) return null;

  const kills = (round.events ?? [])
    .filter((e) => e.type === "kill" && e.t <= time && time - e.t <= WINDOW_SECONDS)
    .slice(-5);

  if (kills.length === 0) return null;

  const playerById = new Map(match.players.map((p) => [p.steamId, p]));
  const side = (id?: number) => {
    if (!id) return undefined;
    const p = playerById.get(id);
    return p?.team === "T" ? "t" : p?.team === "CT" ? "ct" : undefined;
  };
  const name = (id?: number) => (id ? playerById.get(id)?.name ?? "?" : "?");

  return (
    <div className="pointer-events-none absolute right-8 top-5 z-30 flex flex-col items-end gap-1">
      {kills.map((k, i) => {
        const age = time - k.t;
        const opacity = Math.max(0.5, 1 - age / WINDOW_SECONDS);
        const killerSide = side(k.killer);
        const victimSide = side(k.victim);
        return (
          <div
            key={`${k.t}-${i}`}
            className="flex items-center gap-2 px-2 py-0.5 text-[13px]"
            style={{
              opacity,
              textShadow: "0 1px 2px rgba(0,0,0,0.9)",
            }}
          >
            <span
              className="font-medium"
              style={{
                color:
                  killerSide === "ct" ? THEME.ct : killerSide === "t" ? THEME.t : THEME.textMuted,
              }}
            >
              {displayName(name(k.killer))}
            </span>
            {k.weapon && (
              <span
                aria-hidden
                className="inline-block size-4"
                style={{
                  backgroundColor: "#c8c8c8",
                  WebkitMaskImage: `url(${iconPathFor(k.weapon) ?? "/icons/ak47.svg"})`,
                  maskImage: `url(${iconPathFor(k.weapon) ?? "/icons/ak47.svg"})`,
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                }}
              />
            )}
            {k.hs && <span className="text-[10px] font-bold text-red-400">HS</span>}
            <span
              className="font-medium"
              style={{
                color:
                  victimSide === "ct" ? THEME.ct : victimSide === "t" ? THEME.t : THEME.textMuted,
              }}
            >
              {displayName(name(k.victim))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function displayName(name: string) {
  return name === "L999" ? "grosNoob" : name;
}
