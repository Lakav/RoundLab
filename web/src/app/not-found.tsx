import Link from "next/link";

export default function NotFound() {
  return (
    <main id="main-content" className="flex min-h-screen items-center justify-center px-4 py-20">
      <section className="max-w-lg text-center">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-[var(--rl-positive)]">404</p>
        <h1 className="mt-3 text-3xl font-semibold text-white">Cette page n’existe pas</h1>
        <p className="mt-3 text-sm text-[var(--rl-fg-muted)]">Aucune donnée locale n’a été modifiée.</p>
        <Link href="/" className="mt-6 inline-flex rounded-md bg-emerald-300 px-4 py-2 text-sm font-semibold text-neutral-950">
          Revenir à l’accueil
        </Link>
      </section>
    </main>
  );
}
