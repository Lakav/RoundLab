"use client";

import { Button } from "@/components/ui/button";
import { Eraser, MousePointer2, Pencil, Trash2, Undo2 } from "lucide-react";
import type { DrawTool, Stroke } from "./DrawingLayer";
import { cn } from "@/lib/utils";

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ffffff"];

type Props = {
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  color: string;
  setColor: (c: string) => void;
  strokes: Stroke[];
  setStrokes: (s: Stroke[]) => void;
};

const TOOLS: { value: DrawTool; icon: React.ComponentType<{ className?: string }>; title: string }[] = [
  { value: "none", icon: MousePointer2, title: "Select (Alt+V)" },
  { value: "pen", icon: Pencil, title: "Pen (Alt+P)" },
  { value: "eraser", icon: Eraser, title: "Eraser" },
];

export function DrawingToolbar({
  tool,
  setTool,
  color,
  setColor,
  strokes,
  setStrokes,
}: Props) {
  return (
    <div className="flex shrink-0 items-center gap-1 text-[var(--rl-fg-muted)]">
      <div className="flex items-center gap-0.5">
        {TOOLS.map(({ value, icon: Icon, title }) => (
          <button
            key={value}
            type="button"
            onClick={() => setTool(value)}
            title={title}
            aria-pressed={tool === value}
            className={cn(
              "flex size-7 items-center justify-center rounded-[2px] transition-colors",
              tool === value
                ? "text-[#d45aff]"
                : "text-[var(--rl-fg-muted)] hover:bg-white/[0.05] hover:text-[var(--rl-fg)]"
            )}
          >
            <Icon className="size-3.5" />
          </button>
        ))}
      </div>

      <div className="mx-1 flex items-center gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setColor(c)}
            aria-label={`Drawing color ${c}`}
            aria-pressed={color === c}
            style={{ background: c }}
            className={cn(
              "size-3.5 rounded-full ring-1 transition-all",
              color === c ? "ring-white" : "ring-transparent hover:ring-white/30"
            )}
          />
        ))}
      </div>

      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => setStrokes(strokes.slice(0, -1))}
        disabled={strokes.length === 0}
        title="Undo (Cmd+Z)"
        className="size-7 rounded-[2px] text-[var(--rl-fg-muted)] hover:bg-white/[0.05] hover:text-[var(--rl-fg)] disabled:opacity-30"
      >
        <Undo2 className="size-3.5" />
      </Button>
      <Button
        type="button"
        size="icon"
        variant="ghost"
        onClick={() => setStrokes([])}
        disabled={strokes.length === 0}
        title="Clear all"
        className="size-7 rounded-[2px] text-[var(--rl-fg-muted)] hover:bg-white/[0.05] hover:text-[var(--rl-critical)] disabled:opacity-30"
      >
        <Trash2 className="size-3.5" />
      </Button>
    </div>
  );
}
