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

export interface ScoutSpotDto {
  name: string;
  latitude: number;
  longitude: number;
  phase: "sunrise" | "sunset" | "midday";
  reason: string | null;
}

/** AI photo scout for one day of a planned trip. Throws an Error with a readable message on failure */
export async function suggestPhotoSpots(date: string, stops: { name: string; latitude: number; longitude: number }[]): Promise<ScoutSpotDto[]> {
  const res = await fetch("/api/ai/photo-spots", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ date, stops }) });
  const data = (await res.json().catch(() => ({}))) as { spots?: ScoutSpotDto[]; error?: string };
  if (!res.ok) throw new Error(data.error ?? "AI suggestions are unavailable right now");
  return Array.isArray(data.spots) ? data.spots : [];
}

export interface AiTripRouteDto {
  title: string | null;
  startTime: string;
  stops: { name: string; latitude: number; longitude: number; description: string | null; durationMinutes: number; logistics: string | null; transitMinutes: number; transitNote: string | null }[];
}

/** AI Trip Assistant: one prompt → an ordered, timed route for a day. Throws an Error with a readable message on failure */
export async function generateTripRoute(prompt: string, date: string, near: { latitude: number; longitude: number } | null): Promise<AiTripRouteDto> {
  const res = await fetch("/api/ai/trip-route", { method: "POST", headers: await authHeaders(), body: JSON.stringify({ prompt, date, near }) });
  const data = (await res.json().catch(() => ({}))) as Partial<AiTripRouteDto> & { error?: string };
  if (!res.ok || !Array.isArray(data.stops)) throw new Error(data.error ?? "The AI assistant is unavailable right now");
  return data as AiTripRouteDto;
}
