import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "GOTV Analyser",
  description: "CS2 demo replay & analysis",
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
      </body>
    </html>
  );
}
