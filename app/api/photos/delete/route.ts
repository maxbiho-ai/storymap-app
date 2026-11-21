import { NextResponse } from "next/server";
import { getRequestUserId } from "@/lib/server/userAuth";
import { deleteOwnPhoto } from "@/lib/server/ownerDelete";
import { HttpError } from "@/lib/server/externalPins";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/photos/delete  (Authorization: Bearer <supabase access token>)
 * Body: { photoId, imageIndex? }
 *   - no imageIndex (or a single-image photo): deletes the row + all its files (Supabase Storage / R2)
 *   - imageIndex on a multi-image post: removes only that image; the cover moves to the next one
 * → { ok: true, deleted: "photo" } | { ok: true, deleted: "image", photo }
 * Only the owner may delete (checked against the row's user_id). Likes, list items, comments and
 * notifications go with the row (ON DELETE CASCADE).
 */
export async function POST(req: Request) {
  const userId = await getRequestUserId(req);
  if (!userId) return NextResponse.json({ ok: false, error: "Sign in required" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as { photoId?: unknown; imageIndex?: unknown } | null;
  try {
    const result = await deleteOwnPhoto(userId, body?.photoId, body?.imageIndex);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    if (err instanceof HttpError) return NextResponse.json({ ok: false, error: err.message }, { status: err.status });
    console.error("[api/photos/delete]", err);
    return NextResponse.json({ ok: false, error: "Delete failed" }, { status: 500 });
  }
}
