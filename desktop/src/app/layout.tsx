import type { Metadata } from "next";
import { DebugConsoleHost } from "@/components/DebugConsoleHost";
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
    <html lang="en" className="h-full antialiased dark">
      <head>
        <meta
          httpEquiv="Content-Security-Policy"
          content="default-src 'self'; base-uri 'none'; object-src 'none'; form-action 'none'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; worker-src 'self' blob:"
        />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        {children}
        <DebugConsoleHost />
      </body>
    </html>
  );
}
