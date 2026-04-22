"use client";

import { Button } from "@/components/ui/button";
import {
  MousePointer2,
  Pencil,
  ArrowRight,
  Square,
  Circle,
  Eraser,
  Trash2,
  Undo2,
} from "lucide-react";
import type { DrawTool, Stroke } from "./DrawingLayer";
import { cn } from "@/lib/utils";

const COLORS = ["#ef4444", "#f59e0b", "#10b981", "#3b82f6", "#a855f7", "#ffffff"];

type Props = {
  tool: DrawTool;
  setTool: (t: DrawTool) => void;
  color: string;
  setColor: (c: string) => void;
  width: number;
  setWidth: (w: number) => void;
  strokes: Stroke[];
  setStrokes: (s: Stroke[]) => void;
};

const TOOLS: { value: DrawTool; icon: React.ComponentType<{ className?: string }>; title: string }[] = [
  { value: "none", icon: MousePointer2, title: "Select (V)" },
  { value: "pen", icon: Pencil, title: "Pen (P)" },
  { value: "arrow", icon: ArrowRight, title: "Arrow (A)" },
  { value: "rect", icon: Square, title: "Rectangle (R)" },
  { value: "ellipse", icon: Circle, title: "Ellipse (E)" },
  { value: "eraser", icon: Eraser, title: "Eraser" },
];

export function DrawingToolbar({
  tool,
  setTool,
  color,
  setColor,
  width,
  setWidth,
  strokes,
  setStrokes,
}: Props) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-white/10 bg-neutral-900/90 p-2 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="flex flex-col gap-0.5">
        {TOOLS.map(({ value, icon: Icon, title }) => (
          <button
            key={value}
            onClick={() => setTool(value)}
            title={title}
            className={cn(
              "size-9 rounded-lg flex items-center justify-center transition-colors",
              tool === value
                ? "bg-white text-neutral-950"
                : "text-neutral-400 hover:bg-white/5 hover:text-white"
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>

      <div className="h-px w-8 bg-white/10" />

      <div className="grid grid-cols-2 gap-1">
        {COLORS.map((c) => (
          <button
            key={c}
            onClick={() => setColor(c)}
            style={{ background: c }}
            className={cn(
              "size-4 rounded-full ring-2 transition-all",
              color === c ? "ring-white scale-110" : "ring-transparent hover:ring-white/30"
            )}
          />
        ))}
      </div>

      <div className="h-px w-8 bg-white/10" />

      <div className="flex flex-col items-center gap-1 py-1">
        <span className="text-[9px] uppercase tracking-widest text-neutral-500 font-semibold">
          size
        </span>
        <input
          type="range"
          min={1}
          max={10}
          value={width}
          onChange={(e) => setWidth(Number(e.target.value))}
          className="h-4 w-16 -rotate-90 accent-white -my-6"
          title="Stroke width"
        />
        <span className="text-[10px] tabular-nums text-neutral-400 mt-6">{width}</span>
      </div>

      <div className="h-px w-8 bg-white/10" />

      <Button
        size="icon"
        variant="ghost"
        onClick={() => setStrokes(strokes.slice(0, -1))}
        disabled={strokes.length === 0}
        title="Undo (Cmd+Z)"
        className="size-9 text-neutral-400 hover:text-white hover:bg-white/5 disabled:opacity-30"
      >
        <Undo2 className="size-4" />
      </Button>
      <Button
        size="icon"
        variant="ghost"
        onClick={() => setStrokes([])}
        disabled={strokes.length === 0}
        title="Clear all"
        className="size-9 text-neutral-400 hover:text-red-400 hover:bg-white/5 disabled:opacity-30"
      >
        <Trash2 className="size-4" />
      </Button>
    </div>
  );
}
