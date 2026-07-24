import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "This legacy transfer preview is retired. Use the current transfer preview.",
    },
    { status: 410 }
  );
}
