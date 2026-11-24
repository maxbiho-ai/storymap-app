"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useMapStore } from "@/store/mapStore";
import type { Photo } from "@/types/photo";

export type OwnerPatch = Partial<Pick<Photo, "location_name" | "latitude" | "longitude" | "is_manual_location" | "access_info" | "permit_info">>;

/**
 * Owner edit of a photo row. Security is enforced by RLS ("Users can update their own photos":
 * USING/WITH CHECK auth.uid() = user_id), so a non-owner update matches no row and fails here.
 * On success the edit is merged into the map state at once (the pin moves / the name changes).
 */
export async function updateOwnPhoto(id: string, patch: OwnerPatch): Promise<Photo> {
  patch = cleanPatch(patch);

  const { data, error } = await getSupabase().from("photos").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You can only edit your own photos (are you still signed in?)");

  useMapStore.getState().applyEdit(id, patch);
  return data as Photo;
}

/** The same edit on several photos at once (RLS only lets the owner's rows through); returns the ids that changed */
export async function updateOwnPhotos(ids: string[], patch: OwnerPatch): Promise<string[]> {
  patch = cleanPatch(patch);
  const { data, error } = await getSupabase().from("photos").update(patch).in("id", ids).select("id");
  if (error) throw new Error(error.message);
  const done = (data ?? []).map((r) => r.id as string);
  if (!done.length) throw new Error("You can only edit your own photos (are you still signed in?)");
  for (const id of done) useMapStore.getState().applyEdit(id, patch);
  return done;
}

function cleanPatch(patch: OwnerPatch): OwnerPatch {
  if (patch.latitude != null && (!Number.isFinite(patch.latitude) || Math.abs(patch.latitude) > 90)) throw new Error("Invalid latitude");
  if (patch.longitude != null && (!Number.isFinite(patch.longitude) || Math.abs(patch.longitude) > 180)) throw new Error("Invalid longitude");
  if (patch.location_name != null) patch = { ...patch, location_name: patch.location_name.trim() || null };
  for (const k of ["access_info", "permit_info"] as const) {
    if (patch[k] !== undefined) patch = { ...patch, [k]: patch[k]?.trim().slice(0, 600) || null };
  }
  return patch;
}

/** Clipboard with a fallback for non-secure contexts */
export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand("copy");
      ta.remove();
      return ok;
    } catch {
      return false;
    }
  }
}

/**
 * Owner delete through /api/photos/delete (the server also removes the files from Supabase Storage / R2).
 * imageIndex on a multi-image post removes only that image. The map updates at once.
 */
export async function deleteOwnPhoto(id: string, imageIndex?: number): Promise<"photo" | "image"> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Please log in again");
  const res = await fetch("/api/photos/delete", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ photoId: id, imageIndex }),
  });
  const json = (await res.json().catch(() => null)) as { ok?: boolean; error?: string; deleted?: "photo" | "image"; photo?: Photo } | null;
  if (!res.ok || !json?.ok || !json.deleted) throw new Error(json?.error ?? `Delete failed (${res.status})`);

  const store = useMapStore.getState();
  if (json.deleted === "photo") store.markDeleted(id);
  else if (json.photo) {
    const p = json.photo;
    store.applyEdit(id, { image_urls: p.image_urls, photo_url: p.photo_url, thumb_url: p.thumb_url, storage_path: p.storage_path, width: p.width, height: p.height });
  }
  return json.deleted;
}
