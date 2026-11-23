"use client";

import { getSupabase } from "@/lib/supabase/client";
import type { Trip, TripDay } from "@/lib/trip";

export interface SavedTrip {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  updated_at: string;
}

export async function listTrips(): Promise<SavedTrip[]> {
  const { data, error } = await getSupabase()
    .from("planned_trips")
    .select("id, name, start_date, end_date, updated_at")
    .order("updated_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return (data ?? []) as SavedTrip[];
}

/** Insert (no id) or update; returns the saved trip's id */
export async function saveTrip(trip: Trip, userId: string): Promise<string> {
  const row = { name: trip.name.trim() || "My photo trip", start_date: trip.startDate, end_date: trip.endDate, plan: { days: trip.days }, updated_at: new Date().toISOString() };
  const sb = getSupabase();
  if (trip.id) {
    const { error } = await sb.from("planned_trips").update(row).eq("id", trip.id);
    if (error) throw new Error(error.message);
    return trip.id;
  }
  const { data, error } = await sb.from("planned_trips").insert({ ...row, user_id: userId }).select("id").single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

export async function loadTrip(id: string): Promise<Trip> {
  const { data, error } = await getSupabase().from("planned_trips").select("id, name, start_date, end_date, plan").eq("id", id).single();
  if (error) throw new Error(error.message);
  const r = data as { id: string; name: string; start_date: string; end_date: string; plan: { days?: TripDay[] } };
  return { id: r.id, name: r.name, startDate: r.start_date, endDate: r.end_date, days: r.plan?.days ?? [] };
}

export async function deleteTrip(id: string): Promise<void> {
  const { error } = await getSupabase().from("planned_trips").delete().eq("id", id);
  if (error) throw new Error(error.message);
}
