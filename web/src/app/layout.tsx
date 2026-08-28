import type { Metadata } from "next";
import { DebugConsoleHost } from "@/components/DebugConsoleHost";
import { UnhandledErrorMonitor } from "@/components/UnhandledErrorMonitor";
import { TooltipProvider } from "@/components/ui/tooltip";
import { assetPath } from "@/lib/paths";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoundLab",
  description: "CS2 demo replay & analysis",
  icons: {
    icon: assetPath("/logo.png"),
    shortcut: assetPath("/logo.png"),
    apple: assetPath("/logo.png"),
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="fr" className="h-full antialiased dark">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:"
        />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="min-h-full flex flex-col bg-neutral-950 text-[var(--rl-fg)]">
        <nav aria-label="Skip navigation">
          <a
            href="#main-content"
            className="fixed left-3 top-3 z-[100] -translate-y-24 rounded-md bg-white px-4 py-2 font-medium text-black shadow-lg transition-transform focus:translate-y-0 focus:outline-none focus:ring-4 focus:ring-emerald-400"
          >
            Skip to main content
          </a>
        </nav>
        <TooltipProvider delay={300}>{children}</TooltipProvider>
        <UnhandledErrorMonitor />
        <DebugConsoleHost />
      </body>
    </html>
  );
}
