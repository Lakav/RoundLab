import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { writeFile, mkdir, appendFile, unlink, readFile } from "fs/promises";
import { spawn } from "child_process";
import path from "path";

export const runtime = "nodejs";
export const maxDuration = 300;

const DATA_DIR = path.join(process.cwd(), "data");
const DEMO_DIR = path.join(DATA_DIR, "demos");
const PARSED_DIR = path.join(DATA_DIR, "parsed");
const CHUNKS_DIR = path.join(DATA_DIR, "chunks");
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

async function processDemo(id: string, demoPath: string): Promise<{ success: boolean; stderr: string }> {
  const outPath = path.join(PARSED_DIR, `${id}.json.gz`);
  const { code, stderr } = await run(PARSER_BIN, ["-in", demoPath, "-out", outPath]);
  return { success: code === 0, stderr };
}

export async function POST(req: NextRequest) {
  try {
    await mkdir(DEMO_DIR, { recursive: true });
    await mkdir(PARSED_DIR, { recursive: true });
    await mkdir(CHUNKS_DIR, { recursive: true });

    const form = await req.formData();

    // Check if this is a chunk upload
    const chunkIndex = form.get("chunkIndex");
    const totalChunks = form.get("totalChunks");
    const uploadId = form.get("uploadId");
    const fileName = form.get("fileName");
    const chunk = form.get("chunk");

    if (chunkIndex !== null && totalChunks !== null && uploadId && chunk instanceof File) {
      // Handle chunk upload
      const index = parseInt(chunkIndex.toString(), 10);
      const total = parseInt(totalChunks.toString(), 10);

      const chunkDir = path.join(CHUNKS_DIR, uploadId.toString());
      await mkdir(chunkDir, { recursive: true });

      const chunkPath = path.join(chunkDir, `chunk-${index}`);
      const buf = Buffer.from(await chunk.arrayBuffer());
      await writeFile(chunkPath, buf);

      // Check if all chunks are received
      if (index === total - 1) {
        // Assemble chunks
        const demoPath = path.join(DEMO_DIR, `${uploadId}.dem`);

        // Create empty file
        await writeFile(demoPath, "");

        // Append all chunks in order
        for (let i = 0; i < total; i++) {
          const chunkFile = path.join(chunkDir, `chunk-${i}`);
          try {
            const data = await readFile(chunkFile);
            await appendFile(demoPath, data);
          } catch (e) {
            console.error(`Failed to read chunk ${i}:`, e);
            throw e;
          }
        }

        // Clean up chunk directory
        for (let i = 0; i < total; i++) {
          await unlink(path.join(chunkDir, `chunk-${i}`)).catch(() => {});
        }

        // Check if file is zst compressed
        const fileName_str = fileName?.toString().toLowerCase() || "";
        const isZst = fileName_str.endsWith(".zst");

        if (isZst) {
          return NextResponse.json({ error: "Zstd compressed files not supported. Please upload .dem files directly." }, { status: 400 });
        }

        // Process the demo
        const { success, stderr } = await processDemo(uploadId.toString(), demoPath);
        if (!success) {
          return NextResponse.json({ error: "parser failed", stderr }, { status: 500 });
        }

        return NextResponse.json({ id: uploadId });
      }

      return NextResponse.json({ success: true, chunk: index, of: total });
    }

    // Handle single-file upload (backwards compatibility)
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
      return NextResponse.json({ error: "Zstd compressed files not supported. Please upload .dem files directly." }, { status: 400 });
    }

    await writeFile(demoPath, buf);

    const { success, stderr } = await processDemo(id, demoPath);
    if (!success) {
      return NextResponse.json({ error: "parser failed", stderr }, { status: 500 });
    }

    return NextResponse.json({ id, stderr });
  } catch (error) {
    console.error("Upload error:", error);
    return NextResponse.json(
      { error: "Internal server error", details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
