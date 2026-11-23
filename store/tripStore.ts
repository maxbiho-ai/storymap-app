"use client";

import { create } from "zustand";
import { newTrip, withDates, type Stop, type Trip } from "@/lib/trip";

interface TripState {
  open: boolean;
  setOpen: (open: boolean) => void;
  trip: Trip;
  setTrip: (t: Trip) => void;
  setName: (name: string) => void;
  setDates: (start: string, end: string) => void;
  addStop: (day: number, stop: Stop) => void;
  removeStop: (day: number, stopId: string) => void;
  moveStop: (day: number, from: number, to: number) => void;
  reset: () => void;
}

const mapDay = (t: Trip, day: number, fn: (s: Stop[]) => Stop[]): Trip => ({
  ...t,
  days: t.days.map((d, i) => (i === day ? { ...d, stops: fn(d.stops) } : d)),
});

export const useTripStore = create<TripState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  trip: newTrip(),
  setTrip: (trip) => set({ trip }),
  setName: (name) => set((s) => ({ trip: { ...s.trip, name } })),
  setDates: (start, end) => set((s) => ({ trip: withDates(s.trip, start, end) })),
  addStop: (day, stop) => set((s) => ({ trip: mapDay(s.trip, day, (st) => [...st, stop]) })),
  removeStop: (day, stopId) => set((s) => ({ trip: mapDay(s.trip, day, (st) => st.filter((x) => x.id !== stopId)) })),
  moveStop: (day, from, to) =>
    set((s) => ({
      trip: mapDay(s.trip, day, (st) => {
        if (to < 0 || to >= st.length) return st;
        const next = [...st];
        const [it] = next.splice(from, 1);
        next.splice(to, 0, it);
        return next;
      }),
    })),
  reset: () => set({ trip: newTrip() }),
}));
