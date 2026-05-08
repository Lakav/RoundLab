"use client";

import { useEffect, useState } from "react";
import { DebugConsole } from "@/components/DebugConsole";

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

  return <DebugConsole isOpen={open} onClose={() => setOpen(false)} />;
}
