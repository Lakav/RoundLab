import type { MatchAnalysis } from "@/lib/analysis/types";
import type { SpatialAnalysis } from "@/lib/analysis/spatial-types";
import { teamLabel } from "./report-formatters";

export function ReportHero({
  analysis,
  spatial,
}: {
  analysis: MatchAnalysis;
  spatial: SpatialAnalysis | null;
}) {
  const displayedTeams = analysis.teams.slice(0, 2);
  const completeScore = displayedTeams.every((team) => team.score !== null)
    && displayedTeams.reduce((total, team) => total + (team.score ?? 0), 0)
      === analysis.rounds.length;
  const reportMapAsset = spatial?.map && /^de_[a-z0-9_]+$/.test(spatial.map)
    ? `/cs2lens-maps/${spatial.map}.png`
    : null;
  const highestScore = Math.max(...displayedTeams.map((team) => team.score ?? -1));

  return (
    <header className="report-hero relative min-h-[11rem] overflow-hidden rounded-xl border border-white/8 bg-[#121515] px-5 py-6 shadow-[0_24px_80px_rgba(0,0,0,0.3)] sm:px-8 sm:py-7">
      {reportMapAsset && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[length:38rem] bg-[position:84%_48%] bg-no-repeat opacity-[0.16]"
          style={{ backgroundImage: `url("${reportMapAsset}")` }}
        />
      )}
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#111514_0%,rgba(17,21,20,0.82)_46%,rgba(17,21,20,0.94)_100%)]" />
      <div className="absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-emerald-200/20 to-transparent" />
      <div className="relative grid min-h-[7.5rem] gap-7 md:grid-cols-[1fr_auto_1fr] md:items-center">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-emerald-200/15 bg-emerald-200/[0.07] px-2.5 py-1 text-[9px] font-bold uppercase tracking-[0.15em] text-emerald-200">
              Analyse terminée
            </span>
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
              {spatial?.map ? spatial.map.replace(/^de_/, "").toUpperCase() : "Rapport de match"}
            </span>
          </div>
          <h1 className="mt-3 text-[1.75rem] font-semibold tracking-[-0.035em] text-white sm:text-3xl">
            Rapport du match
          </h1>
          <p className="mt-2 text-xs text-neutral-500">
            {analysis.rounds.length} round{analysis.rounds.length > 1 ? "s" : ""} ·{" "}
            {analysis.players.length} joueurs analysés
          </p>
        </div>
        <div className="flex items-center justify-start gap-5 rounded-xl border border-white/[0.07] bg-black/20 px-6 py-4 backdrop-blur-sm md:justify-center">
          {displayedTeams.map((team, index) => (
            <div key={team.logicalTeam} className="contents">
              {index > 0 && <span className="text-xl font-light text-neutral-700">:</span>}
              <div className={index === 1 ? "text-right" : undefined}>
                <div className={[
                  "text-5xl font-semibold leading-none tracking-[-0.06em] tabular-nums",
                  (team.score ?? -1) === highestScore ? "text-emerald-300" : "text-neutral-200",
                ].join(" ")}>
                  {team.score ?? "—"}
                </div>
                <div className="mt-2 max-w-36 truncate text-[11px] font-semibold text-neutral-400">
                  <span
                    className={[
                      "mr-1.5 inline-block size-1.5 rounded-full align-middle",
                      index === 0 ? "bg-sky-300" : "bg-amber-300",
                    ].join(" ")}
                  />
                  {teamLabel(team.name)}
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="hidden justify-self-end text-right md:block">
          <div className="text-[9px] font-bold uppercase tracking-[0.16em] text-neutral-600">
            État des données
          </div>
          <div className="mt-2 text-sm font-semibold text-neutral-200">
            {completeScore
              ? "Score complet"
              : displayedTeams.every((team) => team.score !== null)
                ? "Score observé"
                : "Score incomplet"}
          </div>
          <div className="mt-1 text-[11px] text-neutral-500">Calculé localement</div>
        </div>
      </div>
    </header>
  );
}
