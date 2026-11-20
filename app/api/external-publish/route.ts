import { NextResponse } from "next/server";
import { isAuthorized } from "@/lib/server/auth";
import { buildPinUrl, createExternalPin, deleteExternalPin, parsePublishBody, HttpError } from "@/lib/server/externalPins";
import { errorResponse, unauthorized } from "@/lib/server/respond";

export const runtime = "nodejs"; // sharp + AWS SDK
export const dynamic = "force-dynamic";
export const maxDuration = 60; // download + process up to 10 images + AI

/**
 * POST /api/external-publish
 * Authorization: Bearer <EXTERNAL_PUBLISH_SECRET>
 * Body: { images[], lat, lng, locationName, capturedAt, exif{camera,lens,aperture,shutter,iso}, story,
 *         photographerName? (default "Max Bihovskiy"), tags?, title?, postId? }
 * Runs the same AI pipeline as app uploads: story/title → English, 4-7 word title if none,
 * vision tags + sunrise/sunset time check, post hashtags → tags.
 * → 201 { ok: true, pinId, pinUrl, title, tags, ai }  (200 if postId was already published)
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
    const pin = await createExternalPin(input);
    return NextResponse.json(
      {
        ok: true,
        pinId: pin.pinId,
        pinUrl: buildPinUrl(pin.pinId, req),
        title: pin.title,
        tags: pin.tags,
        ai: pin.ai,
        ...(pin.existing ? { existing: true } : {}),
      },
      { status: pin.existing ? 200 : 201 },
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
