import type { Metadata } from "next";
import { DebugConsoleHost } from "@/components/DebugConsoleHost";
import "./globals.css";

export const metadata: Metadata = {
  title: "RoundLab",
  description: "CS2 demo replay & analysis",
  icons: {
    icon: "/logo.png",
    shortcut: "/logo.png",
    apple: "/logo.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-neutral-950 text-neutral-100">
        {children}
        <DebugConsoleHost />
      </body>
    </html>
  );
}
