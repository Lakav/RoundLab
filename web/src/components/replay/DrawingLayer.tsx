"use client";

import { useEffect, useRef, useState } from "react";

export type DrawTool = "none" | "pen" | "arrow" | "rect" | "ellipse" | "eraser";

export type Stroke = {
  id: string;
  tool: DrawTool;
  color: string;
  width: number;
  points: { x: number; y: number }[]; // normalized 0..1
};

type Props = {
  size: number;
  tool: DrawTool;
  color: string;
  width: number;
  strokes: Stroke[];
  setStrokes: (s: Stroke[]) => void;
};

export function DrawingLayer({
  size,
  tool,
  color,
  width,
  strokes,
  setStrokes,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState<Stroke | null>(null);

  const redraw = () => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = size;
    c.height = size;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, size, size);
    const all = drawing ? [...strokes, drawing] : strokes;
    for (const s of all) drawStroke(ctx, s, size);
  };

  useEffect(redraw, [strokes, drawing, size]);

  const pt = (e: React.PointerEvent) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    const w = c.width || size;
    const h = c.height || size;
    return { x: (e.clientX - r.left) / (r.width || w), y: (e.clientY - r.top) / (r.height || h) };
  };

  const onDown = (e: React.PointerEvent) => {
    if (tool === "none") return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = pt(e);
    if (tool === "eraser") {
      // remove the topmost stroke hit
      const hit = findHit(strokes, p, size);
      if (hit !== -1) setStrokes(strokes.filter((_, i) => i !== hit));
      return;
    }
    setDrawing({
      id: crypto.randomUUID(),
      tool,
      color,
      width,
      points: [p],
    });
  };

  const onMove = (e: React.PointerEvent) => {
    if (!drawing) return;
    const p = pt(e);
    if (drawing.tool === "pen") {
      setDrawing({ ...drawing, points: [...drawing.points, p] });
    } else {
      setDrawing({ ...drawing, points: [drawing.points[0], p] });
    }
  };

  const onUp = () => {
    if (!drawing) return;
    setStrokes([...strokes, drawing]);
    setDrawing(null);
  };

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: tool === "none" ? "none" : "auto",
        cursor: tool === "none" ? "default" : "crosshair",
      }}
    />
  );
}

function drawStroke(
  ctx: CanvasRenderingContext2D,
  s: Stroke,
  size: number
) {
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;

  const pts = s.points.map((p) => ({ x: p.x * size, y: p.y * size }));
  if (pts.length < 1) return;

  if (s.tool === "pen") {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  } else if (s.tool === "arrow" && pts.length >= 2) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const head = Math.max(10, s.width * 3);
    ctx.beginPath();
    ctx.moveTo(b.x, b.y);
    ctx.lineTo(
      b.x - head * Math.cos(angle - Math.PI / 6),
      b.y - head * Math.sin(angle - Math.PI / 6)
    );
    ctx.lineTo(
      b.x - head * Math.cos(angle + Math.PI / 6),
      b.y - head * Math.sin(angle + Math.PI / 6)
    );
    ctx.closePath();
    ctx.fill();
  } else if (s.tool === "rect" && pts.length >= 2) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
  } else if (s.tool === "ellipse" && pts.length >= 2) {
    const [a, b] = [pts[0], pts[pts.length - 1]];
    ctx.beginPath();
    ctx.ellipse(
      (a.x + b.x) / 2,
      (a.y + b.y) / 2,
      Math.abs(b.x - a.x) / 2,
      Math.abs(b.y - a.y) / 2,
      0,
      0,
      Math.PI * 2
    );
    ctx.stroke();
  }
}

function findHit(
  strokes: Stroke[],
  p: { x: number; y: number },
  size: number
): number {
  for (let i = strokes.length - 1; i >= 0; i--) {
    const s = strokes[i];
    for (const pt of s.points) {
      const dx = (pt.x - p.x) * size;
      const dy = (pt.y - p.y) * size;
      if (dx * dx + dy * dy < 400) return i;
    }
  }
  return -1;
}
