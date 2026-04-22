import { NextResponse } from "next/server";
import { readdir, stat } from "fs/promises";
import path from "path";

export const runtime = "nodejs";

export async function GET() {
  const dir = path.join(process.cwd(), "data", "parsed");
  try {
    const files = await readdir(dir);
    const items = await Promise.all(
      files
        .filter((f) => f.endsWith(".json.gz"))
        .map(async (f) => {
          const s = await stat(path.join(dir, f));
          return {
            id: f.replace(".json.gz", ""),
            createdAt: s.mtimeMs,
            size: s.size,
          };
        })
    );
    items.sort((a, b) => b.createdAt - a.createdAt);
    return NextResponse.json(items);
  } catch {
    return NextResponse.json([]);
  }
}
