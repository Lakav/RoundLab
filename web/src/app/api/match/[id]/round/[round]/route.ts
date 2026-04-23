import { NextRequest, NextResponse } from "next/server";
import { findRound, gzipJsonForRound, isValidMatchId, readMatchData } from "@/server/match-data";

export const runtime = "nodejs";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; round: string }> }
) {
  const { id, round } = await params;
  if (!isValidMatchId(id)) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const roundNumber = Number(round);
  if (!Number.isInteger(roundNumber) || roundNumber < 0) {
    return NextResponse.json({ error: "bad round" }, { status: 400 });
  }

  try {
    const data = await readMatchData(id);
    const roundData = findRound(data, roundNumber);
    if (!roundData) {
      return NextResponse.json({ error: "round not found" }, { status: 404 });
    }

    const body = await gzipJsonForRound(id, roundData);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": "application/json",
        "Content-Encoding": "gzip",
        "Cache-Control": "public, max-age=31536000, immutable",
      },
    });
  } catch {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
}
