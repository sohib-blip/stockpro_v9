import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "This legacy transfer endpoint is retired. Use preview and confirmation.",
    },
    { status: 410 }
  );
}
