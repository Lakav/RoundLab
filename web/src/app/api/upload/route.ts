import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { writeFile, mkdir } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

const DATA_DIR = path.join(process.cwd(), "data");
const DEMO_DIR = path.join(DATA_DIR, "demos");
const PARSED_DIR = path.join(DATA_DIR, "parsed");
const PARSER_BIN = path.join(process.cwd(), "..", "parser", "parser");

function run(cmd: string, args: string[]): Promise<{ code: number; stderr: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args);
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d.toString()));
    p.on("error", reject);
    p.on("close", (code) => resolve({ code: code ?? -1, stderr }));
  });
}

export async function POST(req: NextRequest) {
  await mkdir(DEMO_DIR, { recursive: true });
  await mkdir(PARSED_DIR, { recursive: true });

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no file" }, { status: 400 });
  }

  const id = randomUUID();
  const origName = file.name.toLowerCase();
  const isZst = origName.endsWith(".zst");
  const demoPath = path.join(DEMO_DIR, `${id}.dem`);

  const buf = Buffer.from(await file.arrayBuffer());

  if (isZst) {
    const zstPath = path.join(DEMO_DIR, `${id}.dem.zst`);
    await writeFile(zstPath, buf);
    const { code, stderr } = await run("zstd", ["-d", "-f", zstPath, "-o", demoPath]);
    if (code !== 0) {
      return NextResponse.json({ error: "zstd decode failed", stderr }, { status: 500 });
    }
  } else {
    await writeFile(demoPath, buf);
  }

  const outPath = path.join(PARSED_DIR, `${id}.json.gz`);
  const { code, stderr } = await run(PARSER_BIN, ["-in", demoPath, "-out", outPath]);
  if (code !== 0) {
    return NextResponse.json({ error: "parser failed", stderr }, { status: 500 });
  }

  return NextResponse.json({ id, stderr });
}
