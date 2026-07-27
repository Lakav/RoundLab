import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";
import {
  GltfGeometryImportError,
  importMapGeometryFromGltf,
  parseGlb,
  type GltfDocument,
} from "../src/lib/analysis/gltf-map-geometry.ts";

type Arguments = {
  input: string;
  map: string;
  geometryId: string;
  output: string;
  convertYUpToSource: boolean;
  force: boolean;
  scale: number;
};

function usage(): string {
  return [
    "Usage:",
    "  pnpm geometry:import -- --input <map.gltf|map.glb> --map <de_name>",
    "    --geometry-id <version> --output <geometry.json> [--scale <number>]",
    "    [--keep-gltf-axes] [--force]",
  ].join("\n");
}

function parseArguments(values: string[]): Arguments {
  const parsed = new Map<string, string>();
  let force = false;
  let convertYUpToSource = true;
  for (let index = 0; index < values.length; index++) {
    const argument = values[index];
    if (argument === "--") continue;
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--keep-gltf-axes") {
      convertYUpToSource = false;
      continue;
    }
    if (!argument.startsWith("--")) {
      throw new Error(`Unexpected argument: ${argument}\n${usage()}`);
    }
    const value = values[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`Missing value for ${argument}.\n${usage()}`);
    }
    parsed.set(argument, value);
    index++;
  }
  const required = (name: string): string => {
    const value = parsed.get(name);
    if (value === undefined || value.trim().length === 0) {
      throw new Error(`Missing required ${name}.\n${usage()}`);
    }
    return value;
  };
  const scale = Number(parsed.get("--scale") ?? "1");
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new Error("--scale must be a finite positive number.");
  }
  return {
    input: resolve(required("--input")),
    map: required("--map"),
    geometryId: required("--geometry-id"),
    output: resolve(required("--output")),
    convertYUpToSource,
    force,
    scale,
  };
}

function decodeDataUri(uri: string): Uint8Array {
  const match = /^data:([^,]*?),([\s\S]*)$/.exec(uri);
  if (match === null) throw new Error("Invalid data URI in glTF buffer.");
  if (match[1].endsWith(";base64")) {
    return new Uint8Array(Buffer.from(match[2], "base64"));
  }
  return new TextEncoder().encode(decodeURIComponent(match[2]));
}

async function loadBuffers(
  document: GltfDocument,
  inputPath: string,
  binaryChunk?: Uint8Array,
): Promise<Uint8Array[]> {
  const buffers = document.buffers ?? [];
  return Promise.all(buffers.map(async (buffer, index) => {
    let bytes: Uint8Array;
    if (buffer.uri === undefined) {
      if (index !== 0 || binaryChunk === undefined) {
        throw new Error(`Buffer ${index} has no URI or GLB binary chunk.`);
      }
      bytes = binaryChunk;
    } else if (buffer.uri.startsWith("data:")) {
      bytes = decodeDataUri(buffer.uri);
    } else {
      if (/^[a-z]+:/i.test(buffer.uri)) {
        throw new Error(`Remote buffer URI is not supported: ${buffer.uri}`);
      }
      bytes = new Uint8Array(
        await readFile(resolve(dirname(inputPath), buffer.uri)),
      );
    }
    if (bytes.byteLength < buffer.byteLength) {
      throw new Error(
        `Buffer ${index} is shorter than declared (${bytes.byteLength} < ${buffer.byteLength}).`,
      );
    }
    return bytes;
  }));
}

async function outputExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const arguments_ = parseArguments(process.argv.slice(2));
  const extension = extname(arguments_.input).toLowerCase();
  const inputBytes = new Uint8Array(await readFile(arguments_.input));
  let document: GltfDocument;
  let binaryChunk: Uint8Array | undefined;
  if (extension === ".glb") {
    const parsed = parseGlb(inputBytes);
    document = parsed.document;
    binaryChunk = parsed.binaryChunk;
  } else if (extension === ".gltf") {
    try {
      document = JSON.parse(new TextDecoder().decode(inputBytes));
    } catch {
      throw new Error("Input glTF JSON is invalid.");
    }
  } else {
    throw new Error("Input must use the .gltf or .glb extension.");
  }
  const buffers = await loadBuffers(
    document,
    arguments_.input,
    binaryChunk,
  );
  const result = importMapGeometryFromGltf(document, buffers, {
    map: arguments_.map,
    geometryId: arguments_.geometryId,
    convertYUpToSource: arguments_.convertYUpToSource,
    scale: arguments_.scale,
  });
  if (!arguments_.force && await outputExists(arguments_.output)) {
    throw new Error(
      `Output already exists: ${arguments_.output}. Pass --force to replace it.`,
    );
  }
  await mkdir(dirname(arguments_.output), { recursive: true });
  await writeFile(
    arguments_.output,
    `${JSON.stringify(result.geometry)}\n`,
    "utf8",
  );
  process.stdout.write(
    `Imported ${result.triangleCount} triangles from ` +
      `${result.meshInstanceCount} mesh instances into ${arguments_.output}\n`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof GltfGeometryImportError || error instanceof Error
      ? error.message
      : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
