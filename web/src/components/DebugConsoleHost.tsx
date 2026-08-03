"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

const DebugConsole = dynamic(
  () => import("@/components/DebugConsole").then((module) => module.DebugConsole),
  { ssr: false },
);

export function DebugConsoleHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "d") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return open ? <DebugConsole isOpen onClose={() => setOpen(false)} /> : null;
}
