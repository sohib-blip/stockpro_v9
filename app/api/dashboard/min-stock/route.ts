import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "This legacy minimum-stock endpoint is retired. Use the inventory setup endpoint.",
    },
    { status: 410 }
  );
}
