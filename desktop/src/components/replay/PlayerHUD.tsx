"use client";

import { useEffect } from "react";
import { useReplay } from "@/lib/replay-store";
import { cn } from "@/lib/utils";
import type { Frame, PlayerPos } from "@/lib/types";
import { iconPathFor } from "@/lib/icons";
import { THEME, sideColors } from "@/lib/theme";
import { writeDebugLog } from "@/lib/api";

const BOMB_CARRIER_COLOR = "#ef4444";

function sample(frames: Frame[], t: number): PlayerPos[] {
  if (!frames || frames.length === 0) return [];
  if (t <= frames[0].t) return frames[0].players;
  if (t >= frames[frames.length - 1].t) return frames[frames.length - 1].players;
  let lo = 0,
    hi = frames.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t <= t) lo = mid;
    else hi = mid;
  }
  return frames[lo].players;
}

function lastKnownById(frames: Frame[], t: number): Map<number, PlayerPos> {
  const out = new Map<number, PlayerPos>();
  for (const frame of frames) {
    if (frame.t > t) break;
    for (const pos of frame.players) out.set(pos.id, pos);
  }
  if (out.size === 0 && frames[0]) {
    for (const pos of frames[0].players) out.set(pos.id, pos);
  }
  return out;
}

export function PlayerHUD({ side }: { side: "CT" | "T" }) {
  const match = useReplay((s) => s.match);
  const currentRoundIdx = useReplay((s) => s.currentRoundIdx);
  const time = useReplay((s) => s.time) ?? 0;
  const debugRound = match?.rounds[currentRoundIdx];
  useEffect(() => {
    if (!debugRound) return;
    void writeDebugLog(
      "rounds",
      `ROUNDLAB_DEBUG_SCORE hud-round-score ${JSON.stringify({
        source: "hud",
        roundNumber: debugRound.number,
        side,
        ctScore: debugRound.scoreA,
        tScore: debugRound.scoreB,
        winningSide: debugRound.winner ?? null,
      })}`,
    ).catch(() => {});
  }, [debugRound?.number, debugRound?.scoreA, debugRound?.scoreB, debugRound?.winner, side]);
  if (!match) return null;
  const round = match.rounds[currentRoundIdx];
  if (!round) return null;

  const positions = sample(round.frames, time);
  const liveById = new Map(positions.map((p) => [p.id, p]));
  const byId = lastKnownById(round.frames, time);
  const baseRound = match.rounds[0] ?? round;
  const baseTeams = roundTeams(baseRound.frames);
  const currentTeams = roundTeams(round.frames);
  const baseTeamCode = side === "CT" ? 3 : 2;

  // Roster is anchored to the first visible round, so players keep their
  // left/right team slot after half-time. Only the CT/T styling changes.
  const sidePlayers: { steamId: number; name: string }[] = [];
  for (const [id, team] of baseTeams) {
    if (team !== baseTeamCode) continue;
    const info = match.players.find((p) => p.steamId === id);
    sidePlayers.push({ steamId: id, name: info?.name ?? "" });
  }
  sidePlayers.sort((a, b) =>
    a.steamId === b.steamId ? 0 : a.steamId < b.steamId ? -1 : 1,
  );
  const players = sidePlayers.slice(0, 5);
  const currentSideCode = majoritySide(players.map((p) => p.steamId), currentTeams) ?? baseTeamCode;
  const currentSide = currentSideCode === 3 ? "CT" : "T";
  const teamName = displayTeamName(side === "CT" ? match.meta.teamA : match.meta.teamB, side);
  const teamScore = side === "CT" ? round.scoreA : round.scoreB;
  const cols = sideColors(currentSide);

  return (
    <aside
      className={cn(
        "pointer-events-none absolute top-1/2 z-20 flex w-[250px] -translate-y-[48%] flex-col gap-1",
        side === "CT" ? "left-5" : "right-5"
      )}
    >
      <div
        className="mb-2 flex items-center gap-2"
      >
        <div
          className="flex size-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-bold"
          style={{
            background: cols.bgDark,
            borderColor: cols.soft,
            color: "#fff",
          }}
        >
          {(teamName || side).slice(0, 1).toUpperCase()}
        </div>
        <span
          className="flex-1 truncate text-[13px] font-bold uppercase tracking-wide"
          style={{
            color: THEME.textBright,
            textAlign: "left",
          }}
        >
          {teamName || side}
        </span>
        <span
          className="shrink-0 font-mono text-[15px] font-bold tabular-nums"
          style={{ color: THEME.textBright }}
        >
          {teamScore ?? "-"}
        </span>
      </div>

      {players.map((p) => {
        const current = liveById.get(p.steamId);
        const known = current ?? byId.get(p.steamId);
        const pos = current ? current : known ? { ...known, hp: 0 } : undefined;
        const name = p.name || `#${String(p.steamId).slice(-4)}`;
        return <PlayerRow key={p.steamId} name={name} pos={pos} side={currentSide} />;
      })}
    </aside>
  );
}

function roundTeams(frames: Frame[]): Map<number, number> {
  const votes = new Map<number, { ct: number; t: number }>();
  for (const frame of frames) {
    for (const pos of frame.players) {
      let v = votes.get(pos.id);
      if (!v) {
        v = { ct: 0, t: 0 };
        votes.set(pos.id, v);
      }
      if (pos.team === 3) v.ct++;
      else if (pos.team === 2) v.t++;
    }
  }
  const out = new Map<number, number>();
  for (const [id, v] of votes) {
    if (v.ct === 0 && v.t === 0) continue;
    out.set(id, v.ct >= v.t ? 3 : 2);
  }
  return out;
}

function majoritySide(ids: number[], teams: Map<number, number>): number | null {
  let ct = 0;
  let t = 0;
  for (const id of ids) {
    const team = teams.get(id);
    if (team === 3) ct++;
    else if (team === 2) t++;
  }
  if (ct === 0 && t === 0) return null;
  return ct >= t ? 3 : 2;
}

function displayTeamName(name: string, slot: "CT" | "T") {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "CT" || trimmed === "T" || trimmed === "Counter-Terrorists" || trimmed === "Terrorists") {
    return slot === "CT" ? "Team 1" : "Team 2";
  }
  return trimmed;
}

function displayName(name: string) {
  return name === "L999" ? "grosNoob" : name;
}

function isUtility(name: string) {
  return /grenade|flashbang|molotov|incendiary|decoy/i.test(name);
}

function isKnife(name: string) {
  return /knife|bayonet|karambit|butterfly|stiletto|ursus|talon|skeleton|kukri|bowie|flip|gut/i.test(name);
}

function isPistol(name: string) {
  return /deagle|revolver|usp|glock|p2000|hkp2000|p250|five|fiveseven|cz|tec|elite|dual/i.test(name);
}

const UTILITY_ORDER = ["flash", "smoke", "he", "molotov", "incendiary", "decoy"];
function utilityRank(name: string) {
  const n = name.toLowerCase();
  for (let i = 0; i < UTILITY_ORDER.length; i++) {
    if (n.includes(UTILITY_ORDER[i])) return i;
  }
  return UTILITY_ORDER.length;
}

const GUN_ORDER = ["awp", "ssg", "scar", "g3sg", "aug", "sg ", "ak", "m4", "famas", "galil", "p90", "mp", "ump", "bizon", "mac", "nova", "xm", "sawed", "mag", "m249", "negev", "deagle", "revolver", "usp", "glock", "p2000", "hkp2000", "p250", "five", "cz", "tec", "elite", "dual", "zeus", "taser"];
function gunRank(name: string) {
  const n = name.toLowerCase();
  for (let i = 0; i < GUN_ORDER.length; i++) {
    if (n.includes(GUN_ORDER[i])) return i;
  }
  return GUN_ORDER.length;
}

function inventory(pos?: PlayerPos) {
  const weapons = pos?.weapons ?? [];
  const active = pos?.active ?? "";
  const utility = weapons
    .filter((w) => isUtility(w) && !isBombWeapon(w))
    .slice()
    .sort((a, b) => utilityRank(a) - utilityRank(b));
  const guns = weapons.filter((w) => !isUtility(w) && !isKnife(w) && !isBombWeapon(w));
  const primary = guns
    .filter((w) => !isPistol(w))
    .slice()
    .sort((a, b) => gunRank(a) - gunRank(b))[0];
  const secondary = guns
    .filter(isPistol)
    .slice()
    .sort((a, b) => gunRank(a) - gunRank(b))[0];
  const knife = weapons.find(isKnife);
  const hasC4 = Boolean(pos?.hasBomb) || weapons.some((w) => w === "C4" || /bomb|c4/i.test(w));
  return { active, utility, hasC4, primary, secondary, knife };
}

function isBombWeapon(name?: string) {
  return /c4|bomb/i.test(name ?? "");
}

function PlayerRow({
  name,
  pos,
  side,
}: {
  name: string;
  pos?: PlayerPos;
  side: "CT" | "T";
}) {
  const hp = pos?.hp ?? 0;
  const alive = hp > 0;
  const armor = pos?.armor ?? 0;
  const money = pos?.money ?? 0;
  const inv = inventory(pos);
  const cols = sideColors(side);
  const carriesBomb = alive && inv.hasC4;

  const hpPct = Math.max(0, Math.min(100, hp));

  return (
    <div className="pointer-events-auto flex flex-col gap-0.5">
      <div
        className="relative flex h-[24px] w-full items-center overflow-hidden rounded-[2px] bg-[#232424]/90 px-2"
      >
        {/* HP fill in team color */}
        <div
          className="pointer-events-none absolute inset-y-0 left-0 transition-[width] duration-150 ease-out"
          style={{
            width: `${hpPct}%`,
            background: alive ? (carriesBomb ? BOMB_CARRIER_COLOR : cols.bg) : "transparent",
          }}
        />
        <span
          className="relative flex-1 truncate text-[12px] font-semibold"
          style={{
            color: alive ? "#fff" : THEME.textDead,
            textDecoration: !alive ? "line-through" : undefined,
            textAlign: "left",
          }}
        >
          {displayName(name)}
        </span>
        <span
          className="relative shrink-0 px-1 font-mono text-[11px] font-semibold tabular-nums"
          style={{ color: alive ? "#fff" : THEME.textDead }}
        >
          ${money}
        </span>
      </div>

      <div
        className={cn(
          "relative -mt-0.5 h-[3px] w-full overflow-hidden rounded-b-[2px]",
          alive && "bg-white/10",
        )}
      >
        {alive && (
          <span
            className="block h-full transition-[width] duration-150 ease-out"
            style={{
              width: `${Math.max(0, Math.min(100, armor))}%`,
              background: armor > 0 ? cols.soft : "transparent",
              opacity: 0.95,
            }}
          />
        )}
      </div>

      <div
        className="flex h-[18px] w-full items-center gap-1.5 px-0.5"
      >
        {alive && (
          <>
          <Icon
            src={armor > 0 && pos?.helmet ? "/icons/armor_helmet.svg" : "/icons/kevlar.svg"}
            active={armor > 0}
            color={armor > 0 ? "#8f9696" : THEME.textDead}
            size="gear"
          />
          {inv.primary && (
            <Icon
              src={iconPathFor(inv.primary)}
              active
              color={inv.primary === inv.active ? "#91e268" : "#d6dddd"}
              size="weapon"
            />
          )}
          {inv.secondary && (
            <Icon
              src={iconPathFor(inv.secondary)}
              active
              color={inv.secondary === inv.active ? "#91e268" : "#d6dddd"}
              size="sidearm"
            />
          )}
          {inv.hasC4 && (
            <Icon
              src="/icons/c4.svg"
              active
              color={isBombWeapon(inv.active) ? "#f59e0b" : "#f6b15d"}
              size="gear"
            />
          )}
          {pos?.kit && <Icon src="/icons/defuser.svg" active color={cols.soft} size="gear" />}
          <div className="flex-1" />
          {inv.utility.map((u, i) => (
            <Icon
              key={`u-${i}`}
              src={iconPathFor(u)}
              active
              color={u === inv.active ? "#91e268" : "#8f9696"}
              size="utility"
            />
          ))}
          {inv.knife && (
            <Icon
              src={iconPathFor(inv.knife)}
              active
              color={inv.knife === inv.active ? "#91e268" : "#8f9696"}
              size="utility"
            />
          )}
          </>
        )}
      </div>
    </div>
  );
}

function Icon({
  src,
  active,
  color,
  size = "gear",
}: {
  src: string | null;
  active: boolean;
  color: string;
  size?: "gear" | "weapon" | "sidearm" | "utility";
}) {
  if (!src) return null;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-block shrink-0",
        size === "weapon" && "h-[15px] w-[34px]",
        size === "sidearm" && "h-[13px] w-[25px]",
        size === "gear" && "size-[14px]",
        size === "utility" && "size-[11px]"
      )}
      style={{
        backgroundColor: active ? color : THEME.textDead,
        WebkitMaskImage: `url(${src})`,
        maskImage: `url(${src})`,
        WebkitMaskRepeat: "no-repeat",
        maskRepeat: "no-repeat",
        WebkitMaskPosition: "center",
        maskPosition: "center",
        WebkitMaskSize: "contain",
        maskSize: "contain",
        opacity: active ? 1 : 0.4,
      }}
    />
  );
}
