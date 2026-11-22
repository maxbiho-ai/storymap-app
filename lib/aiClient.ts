"use client";

import { getSupabase } from "@/lib/supabase/client";

async function authHeaders(): Promise<Record<string, string>> {
  const { data } = await getSupabase().auth.getSession();
  const token = data.session?.access_token;
  return token
    ? { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
    : { "Content-Type": "application/json" };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Suggested English tags for a photo. Never throws: returns [] on failure */
export async function suggestTags(input: {
  thumb: Blob;
  takenAt: string | null;
  lat: number | null;
  lng: number | null;
  locationName?: string | null;
  title?: string | null;
}): Promise<string[]> {
  try {
    const res = await fetch("/api/ai/tags", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({
        image: await blobToBase64(input.thumb),
        takenAt: input.takenAt,
        lat: input.lat,
        lng: input.lng,
        locationName: input.locationName ?? null,
        title: input.title ?? null,
      }),
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { tags?: string[] };
    return Array.isArray(data.tags) ? data.tags : [];
  } catch {
    return [];
  }
}

/** Translates texts to English (same order). Returns the originals on any failure */
export async function translateToEnglish(texts: string[]): Promise<string[]> {
  if (!texts.some((t) => t.trim())) return texts;
  try {
    const res = await fetch("/api/ai/translate", {
      method: "POST",
      headers: await authHeaders(),
      body: JSON.stringify({ texts }),
    });
    if (!res.ok) return texts;
    const data = (await res.json()) as { texts?: string[] };
    return Array.isArray(data.texts) && data.texts.length === texts.length ? data.texts : texts;
  } catch {
    return texts;
  }
}

export interface FieldNotes {
  accessInfo: string | null;
  permitInfo: string | null;
}

/** Parking / access and permit / drone / ticket notes found in the descriptions (same order). Never throws */
export async function extractFieldNotes(texts: string[]): Promise<FieldNotes[]> {
  const none = texts.map(() => ({ accessInfo: null, permitInfo: null }));
  if (!texts.some((t) => t.trim())) return none;
  try {
    const res = await fetch("/api/ai/field-notes", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ texts }) });
    if (!res.ok) return none;
    const data = (await res.json()) as { notes?: FieldNotes[] };
    return Array.isArray(data.notes) && data.notes.length === texts.length ? data.notes : none;
  } catch {
    return none;
  }
}
