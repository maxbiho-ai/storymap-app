import "server-only";
import { getSupabaseAdmin } from "./supabaseAdmin";
import { r2DeleteAll } from "./r2";
import { HttpError } from "./externalPins";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BUCKET = "photos";

interface Row {
  id: string;
  user_id: string;
  storage_provider: "supabase" | "r2";
  storage_path: string;
  storage_keys: string[] | null;
  photo_url: string;
  thumb_url: string | null;
  image_urls: string[] | null;
}

/** Supabase Storage public URL → object path inside the bucket */
function supabasePath(url: string | null): string | null {
  if (!url) return null;
  const marker = `/storage/v1/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split("?")[0]) : null;
}

/** R2 public URL → object key ("pins/<id>/3.jpg"), independent of the public domain */
function r2Key(url: string, pinId: string): string | null {
  try {
    const path = new URL(url).pathname.split("/").map(decodeURIComponent).join("/");
    const i = path.indexOf(`pins/${pinId}/`);
    return i >= 0 ? path.slice(i) : null;
  } catch {
    return null;
  }
}

const thumbOf = (key: string) => key.replace(/\.jpe?g$/i, "_thumb.jpg");

async function removeFiles(row: Row, keys: string[], wholePin: boolean): Promise<void> {
  if (row.storage_provider === "r2") {
    await r2DeleteAll(keys, wholePin ? `pins/${row.id}/` : undefined);
  } else if (keys.length) {
    const { error } = await getSupabaseAdmin().storage.from(BUCKET).remove(keys);
    if (error) throw new Error(error.message);
  }
}

/**
 * Owner deletes a photo row (and all its files), or one image of a multi-image post.
 * The row goes first, then the files: a storage hiccup leaves an orphan file, never a broken pin.
 */
export async function deleteOwnPhoto(
  userId: string,
  photoId: unknown,
  imageIndex: unknown,
): Promise<{ deleted: "photo" } | { deleted: "image"; photo: Record<string, unknown> }> {
  if (typeof photoId !== "string" || !UUID_RE.test(photoId)) throw new HttpError(400, "Invalid photo id");
  const db = getSupabaseAdmin();
  const { data, error } = await db
    .from("photos")
    .select("id, user_id, storage_provider, storage_path, storage_keys, photo_url, thumb_url, image_urls")
    .eq("id", photoId)
    .maybeSingle();
  if (error) throw new HttpError(500, `Database lookup failed: ${error.message}`);
  if (!data) throw new HttpError(404, "Photo not found");
  const row = data as Row;
  if (row.user_id !== userId) throw new HttpError(403, "Only the owner can delete this photo");

  const urls = row.image_urls ?? [];
  const single = typeof imageIndex === "number" && urls.length > 1;

  if (!single) {
    const { error: delErr } = await db.from("photos").delete().eq("id", row.id).eq("user_id", userId);
    if (delErr) throw new HttpError(500, `Database delete failed: ${delErr.message}`);
    const keys =
      row.storage_provider === "r2"
        ? row.storage_keys ?? []
        : [row.storage_path, supabasePath(row.thumb_url), ...urls.map(supabasePath)].filter((k): k is string => Boolean(k));
    await removeFiles(row, [...new Set(keys)], true).catch((e) => console.warn("[delete] files left behind", row.id, e));
    return { deleted: "photo" };
  }

  const idx = imageIndex as number;
  if (!Number.isInteger(idx) || idx < 0 || idx >= urls.length) throw new HttpError(400, "Invalid image index");

  const removedUrl = urls[idx];
  const rest = urls.filter((_, i) => i !== idx);
  const removedKey = row.storage_provider === "r2" ? r2Key(removedUrl, row.id) : supabasePath(removedUrl);
  const removedKeys = removedKey ? [removedKey, thumbOf(removedKey)] : [];

  const patch: Record<string, unknown> = {
    image_urls: rest,
    storage_keys: (row.storage_keys ?? []).filter((k) => !removedKeys.includes(k)),
  };
  if (idx === 0) {
    // The cover went: the next image becomes the cover (and its thumbnail the pin image)
    const cover = rest[0];
    const coverKey = row.storage_provider === "r2" ? r2Key(cover, row.id) : supabasePath(cover);
    const coverThumbKey = coverKey ? thumbOf(coverKey) : null;
    const hasThumb = coverThumbKey && (row.storage_keys ?? []).includes(coverThumbKey);
    patch.photo_url = cover;
    patch.thumb_url = hasThumb ? cover.replace(/\.jpe?g(\?.*)?$/i, "_thumb.jpg") : cover;
    if (coverKey) patch.storage_path = coverKey;
    patch.width = null; // dimensions described the old cover
    patch.height = null;
  }

  const { data: updated, error: upErr } = await db
    .from("photos")
    .update(patch)
    .eq("id", row.id)
    .eq("user_id", userId)
    .select("*")
    .single();
  if (upErr || !updated) throw new HttpError(500, `Database update failed: ${upErr?.message ?? "no row"}`);
  await removeFiles(row, removedKeys, false).catch((e) => console.warn("[delete] image file left behind", row.id, e));
  return { deleted: "image", photo: updated as Record<string, unknown> };
}
