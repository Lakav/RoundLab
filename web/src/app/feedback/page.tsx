"use client";

import { useMemo, useState } from "react";
import Link from "next/link";

const GITHUB_ISSUE_URL = "https://github.com/lakav/RoundLab/issues/new";

function clean(value: string): string {
  return value.trim() || "Non renseigné";
}

export default function FeedbackPage() {
  const [category, setCategory] = useState("Bug d’interface");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState("");
  const [expected, setExpected] = useState("");
  const [copied, setCopied] = useState(false);

  const report = useMemo(() => {
    const environment = typeof navigator === "undefined"
      ? "Navigateur non renseigné"
      : navigator.userAgent;
    return [
      `## Type`,
      category,
      "",
      "## Problème observé",
      clean(description),
      "",
      "## Étapes pour reproduire",
      clean(steps),
      "",
      "## Résultat attendu",
      clean(expected),
      "",
      "## Environnement",
      environment,
      "",
      "> Rapport préparé depuis la page de signalement RoundLab.",
    ].join("\n");
  }, [category, description, expected, steps]);

  const githubUrl = `${GITHUB_ISSUE_URL}?${new URLSearchParams({
    title: title.trim() ? `[${category}] ${title.trim()}` : `[${category}]`,
    body: report,
  }).toString()}`;

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(`${title.trim()}\n\n${report}`);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-[#0d100f] text-[var(--rl-fg)]">
      <div className="product-grid pointer-events-none absolute inset-x-0 top-0 h-[38rem] opacity-60" />
      <header className="relative z-10 border-b border-white/[0.07] bg-[#0d100f]/88 backdrop-blur-xl">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center justify-between px-5 sm:px-8">
          <Link href="/" className="text-[15px] font-semibold tracking-[-0.01em] text-white">
            RoundLab
          </Link>
          <span className="rounded border border-emerald-200/15 bg-emerald-200/[0.055] px-2 py-0.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--rl-positive)]">
            Bêta
          </span>
        </div>
      </header>

      <main id="main-content" tabIndex={-1} className="relative z-10 mx-auto w-full max-w-5xl px-5 py-10 sm:px-8 sm:py-14">
        <Link href="/" className="text-xs font-medium text-[var(--rl-fg-dim)] transition-colors hover:text-[var(--rl-fg)]">
          Retour à l’accueil
        </Link>

        <div className="mt-8 grid gap-10 lg:grid-cols-[0.72fr_1.28fr]">
          <section>
            <span className="text-xs font-bold uppercase tracking-[0.17em] text-[var(--rl-positive)]">
              Retour bêta
            </span>
            <h1 className="mt-4 text-4xl font-semibold leading-tight tracking-[-0.035em] text-white">
              Signaler un problème
            </h1>
            <p className="mt-4 text-sm leading-6 text-[var(--rl-fg-muted)]">
              Décris précisément ce qui ne fonctionne pas. Le rapport sera ouvert sous forme d’issue GitHub préremplie.
            </p>

            <div className="mt-8 border-l border-[var(--rl-border)] pl-5">
              <h2 className="text-xs font-semibold text-[var(--rl-fg)]">Avant d’envoyer</h2>
              <ul className="mt-3 space-y-2 text-xs leading-5 text-[var(--rl-fg-dim)]">
                <li>Indique la page et l’action qui déclenchent le problème.</li>
                <li>Ne joins pas de démo contenant des données que tu ne veux pas partager.</li>
                <li>Une capture d’écran peut être ajoutée ensuite directement sur GitHub.</li>
              </ul>
            </div>

            <div className="mt-8 rounded-lg border border-amber-100/10 bg-amber-100/[0.025] p-4 text-xs leading-5 text-[var(--rl-fg-dim)]">
              RoundLab est régulièrement modifié pendant la bêta. Cette bêta est gratuite ; la version finale stable sera payante.
            </div>
          </section>

          <form
            onSubmit={(event) => {
              event.preventDefault();
              window.location.assign(githubUrl);
            }}
            className="rounded-xl border border-white/[0.09] bg-[#131716]/95 p-5 shadow-[0_30px_90px_rgba(0,0,0,0.3)] sm:p-6"
          >
            <div className="grid gap-5">
              <label className="grid gap-2 text-xs font-semibold text-[var(--rl-fg-muted)]">
                Type de problème
                <select
                  value={category}
                  onChange={(event) => setCategory(event.target.value)}
                  className="h-11 rounded-md border border-[var(--rl-border)] bg-black/20 px-3 text-sm font-normal text-[var(--rl-fg)] outline-none transition-colors focus:border-emerald-200/35"
                >
                  <option>Bug d’interface</option>
                  <option>Statistique incorrecte</option>
                  <option>Import impossible</option>
                  <option>Replay incorrect</option>
                  <option>Problème de performance</option>
                  <option>Autre</option>
                </select>
              </label>

              <label className="grid gap-2 text-xs font-semibold text-[var(--rl-fg-muted)]">
                Titre
                <input
                  required
                  value={title}
                  onChange={(event) => setTitle(event.target.value)}
                  placeholder="Résumé court du problème"
                  className="h-11 rounded-md border border-[var(--rl-border)] bg-black/20 px-3 text-sm font-normal text-[var(--rl-fg)] outline-none placeholder:text-[var(--rl-fg-dim)] focus:border-emerald-200/35"
                />
              </label>

              <label className="grid gap-2 text-xs font-semibold text-[var(--rl-fg-muted)]">
                Ce qui s’est passé
                <textarea
                  required
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Décris le problème et les éventuels messages d’erreur."
                  rows={5}
                  className="resize-y rounded-md border border-[var(--rl-border)] bg-black/20 px-3 py-3 text-sm font-normal leading-6 text-[var(--rl-fg)] outline-none placeholder:text-[var(--rl-fg-dim)] focus:border-emerald-200/35"
                />
              </label>

              <label className="grid gap-2 text-xs font-semibold text-[var(--rl-fg-muted)]">
                Étapes pour reproduire
                <textarea
                  value={steps}
                  onChange={(event) => setSteps(event.target.value)}
                  placeholder={"1. Ouvrir…\n2. Cliquer sur…\n3. Observer…"}
                  rows={4}
                  className="resize-y rounded-md border border-[var(--rl-border)] bg-black/20 px-3 py-3 text-sm font-normal leading-6 text-[var(--rl-fg)] outline-none placeholder:text-[var(--rl-fg-dim)] focus:border-emerald-200/35"
                />
              </label>

              <label className="grid gap-2 text-xs font-semibold text-[var(--rl-fg-muted)]">
                Résultat attendu
                <textarea
                  value={expected}
                  onChange={(event) => setExpected(event.target.value)}
                  placeholder="Explique ce que l’application aurait dû afficher ou faire."
                  rows={3}
                  className="resize-y rounded-md border border-[var(--rl-border)] bg-black/20 px-3 py-3 text-sm font-normal leading-6 text-[var(--rl-fg)] outline-none placeholder:text-[var(--rl-fg-dim)] focus:border-emerald-200/35"
                />
              </label>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-3 border-t border-white/[0.07] pt-5 sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                onClick={() => void copyReport()}
                className="h-10 rounded-md border border-[var(--rl-border)] px-4 text-xs font-semibold text-[var(--rl-fg-muted)] transition-colors hover:bg-white/[0.04] hover:text-[var(--rl-fg)]"
              >
                {copied ? "Rapport copié" : "Copier le rapport"}
              </button>
              <button
                type="submit"
                className="h-10 rounded-md bg-emerald-200 px-5 text-xs font-bold text-[#102019] transition-colors hover:bg-emerald-100"
              >
                Continuer sur GitHub
              </button>
            </div>
            <p className="mt-3 text-right text-xs leading-4 text-[var(--rl-fg-dim)]">
              Un compte GitHub est nécessaire pour publier le signalement.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
