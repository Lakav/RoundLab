import { NextRequest, NextResponse } from "next/server";
import { isValidMatchId, readMatchData, toMatchMetadata } from "@/server/match-data";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  if (!isValidMatchId(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  try {
    const data = await readMatchData(id);
    return NextResponse.json(toMatchMetadata(data), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
