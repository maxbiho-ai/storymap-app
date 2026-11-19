import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/server/auth";
import { deleteExternalPin } from "@/lib/server/externalPins";
import { errorResponse, unauthorized } from "@/lib/server/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/external-delete
 * Authorization: Bearer <EXTERNAL_PUBLISH_SECRET>
 * Body: { pinId }   (או ?pinId= ב-URL)
 * → 200 { ok: true }
 * חלופה ל-DELETE /api/external-publish?pinId= עבור לקוחות שלא שולחים DELETE.
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  try {
    let pinId = new URL(req.url).searchParams.get("pinId");
    if (!pinId) {
      const body = (await req.json().catch(() => null)) as { pinId?: unknown } | null;
      pinId = typeof body?.pinId === "string" ? body.pinId : null;
    }
    await deleteExternalPin(pinId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
