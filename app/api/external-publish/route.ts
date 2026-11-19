import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/server/auth";
import { buildPinUrl, createExternalPin, deleteExternalPin, parsePublishBody, HttpError } from "@/lib/server/externalPins";
import { errorResponse, unauthorized } from "@/lib/server/respond";

export const runtime = "nodejs"; // sharp + AWS SDK
export const dynamic = "force-dynamic";
export const maxDuration = 60; // הורדה ועיבוד של עד 10 תמונות

/**
 * POST /api/external-publish
 * Authorization: Bearer <EXTERNAL_PUBLISH_SECRET>
 * Body: { images[], lat, lng, locationName, capturedAt, exif{camera,lens,aperture,shutter,iso}, story,
 *         title?, tags?, postId? }
 * → 201 { ok: true, pinId, pinUrl }  (200 אם postId כבר פורסם)
 */
export async function POST(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  try {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new HttpError(400, "Invalid JSON body");
    }
    const input = parsePublishBody(body);
    const { pinId, existing } = await createExternalPin(input);
    return NextResponse.json(
      { ok: true, pinId, pinUrl: buildPinUrl(pinId, req), ...(existing ? { existing: true } : {}) },
      { status: existing ? 200 : 201 },
    );
  } catch (err) {
    return errorResponse(err);
  }
}

/**
 * DELETE /api/external-publish?pinId=<id>
 * → 200 { ok: true }
 */
export async function DELETE(req: Request) {
  if (!isAuthorized(req)) return unauthorized();
  try {
    await deleteExternalPin(new URL(req.url).searchParams.get("pinId"));
    return NextResponse.json({ ok: true });
  } catch (err) {
    return errorResponse(err);
  }
}
