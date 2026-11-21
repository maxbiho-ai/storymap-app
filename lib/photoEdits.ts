"use client";

import { getSupabase } from "@/lib/supabase/client";
import { useMapStore } from "@/store/mapStore";
import type { Photo } from "@/types/photo";

export type OwnerPatch = Partial<Pick<Photo, "location_name" | "latitude" | "longitude" | "is_manual_location">>;

/**
 * Owner edit of a photo row. Security is enforced by RLS ("Users can update their own photos":
 * USING/WITH CHECK auth.uid() = user_id), so a non-owner update matches no row and fails here.
 * On success the edit is merged into the map state at once (the pin moves / the name changes).
 */
export async function updateOwnPhoto(id: string, patch: OwnerPatch): Promise<Photo> {
  if (patch.latitude != null && (!Number.isFinite(patch.latitude) || Math.abs(patch.latitude) > 90)) throw new Error("Invalid latitude");
  if (patch.longitude != null && (!Number.isFinite(patch.longitude) || Math.abs(patch.longitude) > 180)) throw new Error("Invalid longitude");
  if (patch.location_name != null) patch = { ...patch, location_name: patch.location_name.trim() || null };

  const { data, error } = await getSupabase().from("photos").update(patch).eq("id", id).select("*").maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You can only edit your own photos (are you still signed in?)");

  useMapStore.getState().applyEdit(id, patch);
  return data as Photo;
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
