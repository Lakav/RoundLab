"use client";

import { KillFeedIcon, type KillFeedIconKind } from "@/components/replay/KillFeedIcon";
import { iconPathFor } from "@/lib/icons";
import { useReplay } from "@/lib/replay-store";
import { THEME } from "@/lib/theme";
import type { MatchEvent, PlayerId } from "@/lib/types";

const WINDOW_SECONDS = 6;

export function KillFeed() {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const time = useReplay((s) => s.time) ?? 0;
  if (!match) return null;
  const round = match.rounds[currentRoundIdx];
  if (!round) return null;

  const kills = (round.events ?? [])
    .filter((event) => event.type === "kill" && event.t <= time && time - event.t <= WINDOW_SECONDS)
    .slice(-5);

  if (kills.length === 0) return null;

  const playerById = new Map(match.players.map((player) => [player.steamId, player]));
  const side = (id?: PlayerId) => {
    if (!id) return undefined;
    const player = playerById.get(id);
    return player?.team === "T" ? "t" : player?.team === "CT" ? "ct" : undefined;
  };
  const name = (id?: PlayerId) => (id ? playerById.get(id)?.name ?? "?" : "World");

  return (
    <div className="pointer-events-none absolute right-3 top-4 z-40 flex flex-col items-end gap-1 md:right-8 md:top-5">
      {kills.map((kill, index) => {
        const age = time - kill.t;
        const opacity = Math.max(0.46, 1 - age / WINDOW_SECONDS);
        const killerSide = side(kill.killer);
        const assistSide = side(kill.assist);
        const victimSide = side(kill.victim);
        const weaponIcon = iconPathFor(kill.weapon);
        const suicide = !kill.killer || kill.killer === kill.victim;
        const leadingIcons = killFeedIcons(kill, "leading");
        const trailingIcons = killFeedIcons(kill, "trailing");
        const resultIcons = killFeedIcons(kill, "result");

        return (
          <div
            key={`${kill.t}-${kill.killer ?? "world"}-${kill.victim ?? "unknown"}-${index}`}
            aria-label={killFeedLabel(kill, name)}
            className="flex min-h-7 max-w-[calc(100vw-1.5rem)] items-center gap-1.5 rounded-[3px] border border-white/[0.08] bg-[#080a0b]/78 px-2.5 py-0.5 text-[13px] shadow-lg shadow-black/25 backdrop-blur-md"
            style={{
              opacity,
              textShadow: "0 1px 2px rgba(0,0,0,0.92)",
            }}
          >
            {leadingIcons.map((kind) => (
              <KillFeedIcon key={kind} kind={kind} />
            ))}

            {!suicide && (
              <PlayerName name={name(kill.killer)} side={killerSide} />
            )}

            {kill.assist && kill.assist !== kill.killer && (
              <>
                <span className="text-[11px] font-bold text-white/55">+</span>
                {kill.flashAssist && <KillFeedIcon kind="flash-assist" />}
                <PlayerName name={name(kill.assist)} side={assistSide} />
              </>
            )}

            {weaponIcon ? (
              <span
                aria-hidden="true"
                className="inline-block h-[17px] w-8 shrink-0"
                data-killfeed-icon="weapon"
                style={{
                  backgroundColor: "#d9dddf",
                  WebkitMaskImage: `url(${weaponIcon})`,
                  maskImage: `url(${weaponIcon})`,
                  WebkitMaskRepeat: "no-repeat",
                  maskRepeat: "no-repeat",
                  WebkitMaskPosition: "center",
                  maskPosition: "center",
                  WebkitMaskSize: "contain",
                  maskSize: "contain",
                }}
              />
            ) : (
              <span className="text-[10px] font-semibold uppercase tracking-wide text-white/55">
                {kill.weapon || (suicide ? "death" : "kill")}
              </span>
            )}

            {trailingIcons.map((kind) => (
              <KillFeedIcon key={kind} kind={kind} />
            ))}

            <PlayerName name={name(kill.victim)} side={victimSide} />

            {resultIcons.map((kind) => (
              <KillFeedIcon key={kind} kind={kind} />
            ))}
          </div>
        );
      })}
    </div>
  );
}

function PlayerName({ name, side }: { name: string; side?: "ct" | "t" }) {
  return (
    <span
      className="max-w-36 truncate font-medium"
      style={{ color: side === "ct" ? THEME.ct : side === "t" ? THEME.t : THEME.textMuted }}
    >
      {displayName(name)}
    </span>
  );
}

function killFeedIcons(
  kill: MatchEvent,
  position: "leading" | "trailing" | "result"
): KillFeedIconKind[] {
  if (position === "leading") {
    return [kill.attackerBlind && "blind"].filter(
      (kind): kind is KillFeedIconKind => Boolean(kind)
    );
  }
  if (position === "trailing") {
    return [
      kill.noScope && "no-scope",
      kill.throughSmoke && "smoke",
      Boolean(kill.penetrated) && "wallbang",
      kill.hs && "headshot",
    ].filter((kind): kind is KillFeedIconKind => Boolean(kind));
  }
  return [
    kill.dominated && "domination",
    kill.revenge && "revenge",
  ].filter((kind): kind is KillFeedIconKind => Boolean(kind));
}

function killFeedLabel(kill: MatchEvent, name: (id?: PlayerId) => string) {
  const killer = displayName(name(kill.killer));
  const victim = displayName(name(kill.victim));
  const descriptions = [
    kill.attackerBlind && "while blinded",
    kill.noScope && "no-scope",
    kill.throughSmoke && "through smoke",
    Boolean(kill.penetrated) && `through ${kill.penetrated} surface${kill.penetrated === 1 ? "" : "s"}`,
    kill.hs && "headshot",
    kill.dominated && "domination",
    kill.revenge && "revenge",
  ].filter(Boolean);
  const assisted = kill.assist
    ? `, assisted by ${displayName(name(kill.assist))}${kill.flashAssist ? " with a flashbang" : ""}`
    : "";
  const method = kill.weapon ? ` with ${kill.weapon}` : "";
  const modifiers = descriptions.length ? `, ${descriptions.join(", ")}` : "";

  if (!kill.killer || kill.killer === kill.victim) {
    return `${victim} died${method}${modifiers}`;
  }
  return `${killer} eliminated ${victim}${method}${assisted}${modifiers}`;
}

function displayName(name: string) {
  return name === "L999" ? "grosNoob" : name;
}
