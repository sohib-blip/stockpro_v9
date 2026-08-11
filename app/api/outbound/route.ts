import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      ok: false,
      error:
        "This legacy endpoint has been retired. Use the reviewed outbound confirmation flow.",
    },
    { status: 410 }
  );
}
