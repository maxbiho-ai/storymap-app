"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRoutesStore, type RouteDraft } from "@/store/routesStore";
import { useMapStore } from "@/store/mapStore";
import { useTripStore } from "@/store/tripStore";
import { LIGHT_ICON, LIGHT_PHASES, TIP_ICON, normalizeRoute, slugify, type LightPhase, type RouteDay, type RouteStop, type RouteTip, type TipKind } from "@/lib/readyRoutes";
import { createReadyRoute, deleteReadyRoute, slugTakenByOther, updateReadyRoute } from "@/lib/readyRoutesApi";
import { draftFromParsed, emptyDraft, matchNearbyPhotos, parseRouteFile } from "@/lib/routeImport";
import { routeToTrip } from "@/lib/readyRoutesTrip";
import { formatLatLng, reverseGeocode } from "@/lib/geocode";

const TIP_KINDS: TipKind[] = ["photo", "parking", "drone"];
const input = "w-full rounded-lg border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-amber-300/70";
const small = "rounded-md bg-white/10 px-2 py-1 text-xs font-semibold text-neutral-100 hover:bg-white/20 disabled:opacity-40";

/** "64.14, -21.94" (or with spaces / semicolons) → coordinates */
function parseLatLng(s: string): { latitude: number; longitude: number } | null {
  const m = s.trim().match(/^(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  const latitude = Number(m[1]);
  const longitude = Number(m[2]);
  return Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180 ? { latitude, longitude } : null;
}

/** Tips back into the Trip Planner's one-per-line text (tips the planner rebuilds from stop logistics are left out) */
function tipsToText(tips: RouteTip[], stops: RouteStop[]): string {
  return tips
    .filter((t) => !(t.stop && stops.some((s) => s.name === t.stop && s.logistics === t.text)))
    .map((t) => (t.kind === "photo" ? t.text : `${t.kind}: ${t.text}`))
    .join("\n");
}

/** Admin: create / upload, edit and delete a Ready Route (curated_routes) */
export default function RouteEditor() {
  const editor = useRoutesStore((s) => s.editor);
  const close = useRoutesStore((s) => s.closeEditor);
  const bump = useRoutesStore((s) => s.bump);
  const active = useRoutesStore((s) => s.active);
  const openRoute = useRoutesStore((s) => s.openRoute);
  const closeRoute = useRoutesStore((s) => s.closeRoute);
  const setGalleryOpen = useRoutesStore((s) => s.setGalleryOpen);
  const setPlannerPrefill = useRoutesStore((s) => s.setPlannerPrefill);
  const pickMode = useMapStore((s) => s.pickMode);
  const picked = useMapStore((s) => s.pickedLocation);
  const startPick = useMapStore((s) => s.startPick);
  const setPicked = useMapStore((s) => s.setPicked);

  const [draft, setDraft] = useState<RouteDraft | null>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [openStop, setOpenStop] = useState<string | null>(null);
  const [coords, setCoords] = useState<Record<number, string>>({});
  const [pickingDay, setPickingDay] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // A new editor session
  useEffect(() => {
    setDraft(editor?.draft ? structuredClone(editor.draft) : null);
    setDirty(false);
    setError(null);
    setNotice(null);
    setOpenStop(null);
    setCoords({});
    setPickingDay(null);
  }, [editor]);

  const update = (fn: (d: RouteDraft) => RouteDraft) => {
    setDraft((d) => (d ? fn(d) : d));
    setDirty(true);
  };
  const setDays = (fn: (days: RouteDay[]) => RouteDay[]) => update((d) => ({ ...d, plan: { days: fn(d.plan.days) } }));
  const setStops = (day: number, fn: (s: RouteStop[]) => RouteStop[]) => setDays((days) => days.map((d, i) => (i === day ? { ...d, stops: fn(d.stops) } : d)));
  const patchStop = (day: number, idx: number, patch: Partial<RouteStop>) => setStops(day, (s) => s.map((x, i) => (i === idx ? { ...x, ...patch } : x)));

  const addStopAt = async (day: number, ll: { latitude: number; longitude: number }, name?: string) => {
    let n = name?.trim();
    if (!n) n = (await reverseGeocode(ll.latitude, ll.longitude).catch(() => []))[0]?.name ?? formatLatLng(ll.latitude, ll.longitude);
    setStops(day, (s) => [...s, { name: n!.slice(0, 140), latitude: Number(ll.latitude.toFixed(6)), longitude: Number(ll.longitude.toFixed(6)), thumb: null, light: "Golden Hour", description: null, logistics: null, durationMinutes: 60 }]);
  };

  // 📍 Pick on map: the editor hides while the map is in pick mode
  useEffect(() => {
    if (pickingDay === null || pickMode) return;
    if (picked) {
      void addStopAt(pickingDay, picked);
      setPicked(null);
    }
    setPickingDay(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickMode, picked, pickingDay]);

  const stops = useMemo(() => draft?.plan.days.flatMap((d) => d.stops) ?? [], [draft]);
  const thumbs = useMemo(() => [...new Set(stops.map((s) => s.thumb).filter(Boolean) as string[])].slice(0, 12), [stops]);

  if (!editor) return null;

  const tryClose = () => {
    if (dirty && !window.confirm("Discard your changes to this route?")) return;
    close();
  };

  const importFile = async (file: File) => {
    setError(null);
    setNotice(null);
    setBusy("Reading the file…");
    try {
      const parsed = await parseRouteFile(file);
      let d = draftFromParsed(parsed, file.name);
      setBusy("Matching StoryMap photos within 500 m…");
      const { days, matched } = await matchNearbyPhotos(d.plan.days).catch(() => ({ days: d.plan.days, matched: 0 }));
      d = { ...d, plan: { days }, cover_url: d.cover_url ?? days.flatMap((x) => x.stops).find((s) => s.thumb)?.thumb ?? null };
      if (draft?.id) d = { ...d, id: draft.id, slug: draft.slug || d.slug, title: draft.title || d.title, published: draft.published, sort_order: draft.sort_order };
      setDraft(d);
      setDirty(true);
      const total = days.reduce((n, x) => n + x.stops.length, 0);
      setNotice(`Imported ${parsed.summary}: ${total} stops in ${days.length} day${days.length === 1 ? "" : "s"}. ${matched} matched nearby StoryMap photos. Fill in the details, then save.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not read that file");
    } finally {
      setBusy(null);
    }
  };

  const rematch = async () => {
    if (!draft) return;
    setBusy("Matching StoryMap photos within 500 m…");
    setError(null);
    try {
      const { days, matched } = await matchNearbyPhotos(draft.plan.days);
      update((d) => ({ ...d, plan: { days }, cover_url: d.cover_url || days.flatMap((x) => x.stops).find((s) => s.thumb)?.thumb || null }));
      setNotice(`${matched} stop${matched === 1 ? "" : "s"} matched nearby photos (stops that already had a photo and a light were kept).`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Photo matching failed");
    } finally {
      setBusy(null);
    }
  };

  /** The row as saved: empty days dropped, counts and cover filled */
  const finalRow = (d: RouteDraft) => {
    const days = d.plan.days.filter((x) => x.stops.length).map((x) => ({ title: x.title?.trim() || null, stops: x.stops }));
    const all = days.flatMap((x) => x.stops);
    return {
      slug: slugify(d.slug || d.title),
      title: d.title.trim().slice(0, 140),
      country: d.country?.trim() || null,
      description: d.description?.trim().slice(0, 2000) || null,
      days: Math.min(60, Math.max(1, days.length)),
      stops_count: all.length,
      cover_url: d.cover_url?.trim() || all.find((s) => s.thumb)?.thumb || null,
      plan: { days },
      tips: d.tips.map((t) => ({ ...t, text: t.text.trim(), stop: t.stop?.trim() || null })).filter((t) => t.text),
      published: d.published,
      sort_order: Number.isFinite(d.sort_order) ? Math.round(d.sort_order) : 0,
    };
  };

  const save = async () => {
    if (!draft) return;
    const row = finalRow(draft);
    if (!row.title) return setError("Give the route a title.");
    if (!row.stops_count) return setError("Add at least one stop.");
    setError(null);
    setBusy("Saving…");
    try {
      if (await slugTakenByOther(row.slug, draft.id)) throw new Error(`Another route already uses the link "${row.slug}". Pick a different slug.`);
      const saved = draft.id ? await updateReadyRoute(draft.id, row) : await createReadyRoute(row);
      bump();
      if (active?.id === saved.id) openRoute(saved);
      setDirty(false);
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the route");
    } finally {
      setBusy(null);
    }
  };

  const remove = async () => {
    if (!draft?.id) return;
    if (!window.confirm(`Delete "${draft.title || draft.slug}" from Ready Routes?\n\nIts link (?route=${draft.slug}) stops working. This can't be undone.`)) return;
    setBusy("Deleting…");
    try {
      await deleteReadyRoute(draft.id);
      if (active?.id === draft.id) closeRoute();
      bump();
      close();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the route");
    } finally {
      setBusy(null);
    }
  };

  const openInPlanner = () => {
    if (!draft) return;
    const row = finalRow(draft);
    if (!row.stops_count) return setError("Add at least one stop first.");
    if (dirty && !window.confirm("Open in the Trip Planner? Unsaved changes here go with it, but are only kept if you publish from the planner.")) return;
    const route = normalizeRoute({ ...row, id: draft.id ?? "draft", created_at: new Date().toISOString() });
    const trip = useTripStore.getState();
    trip.setTrip(routeToTrip(route, { forEditing: true }));
    setPlannerPrefill({ title: row.title, slug: row.slug, country: row.country ?? "", description: row.description ?? "", tips: tipsToText(row.tips, route.plan.days.flatMap((x) => x.stops)), published: row.published, sort_order: row.sort_order });
    closeRoute();
    setGalleryOpen(false);
    close();
    trip.setOpen(true);
  };

  const dayCount = draft?.plan.days.length ?? 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="route-editor-title"
      className={`fixed inset-0 z-[70] flex items-end justify-center bg-black/65 backdrop-blur-sm md:items-center md:p-6 ${pickMode ? "hidden" : ""}`}
    >
      <div className="flex max-h-[95dvh] w-full max-w-3xl flex-col overflow-hidden rounded-t-3xl border border-white/10 bg-neutral-950 text-neutral-100 shadow-2xl md:rounded-3xl">
        <div className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-sky-300">Admin · Ready Routes</p>
            <h2 id="route-editor-title" className="truncate text-lg font-semibold">
              {editor.mode === "edit" ? `Edit: ${draft?.title || "route"}` : draft ? "New route" : "+ Upload Route"}
            </h2>
          </div>
          <button type="button" onClick={tryClose} aria-label="Close editor" className="ml-auto text-2xl leading-none text-neutral-400 hover:text-white">×</button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {/* Import / start */}
          {(!draft || editor.mode === "new") && (
            <section
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOver(false);
                const f = e.dataTransfer.files?.[0];
                if (f) void importFile(f);
              }}
              className={`rounded-2xl border-2 border-dashed p-5 text-center transition ${dragOver ? "border-amber-300 bg-amber-300/10" : "border-white/15 bg-white/[0.03]"}`}
            >
              <p className="text-sm font-semibold">Upload a .gpx, .kml or .json route</p>
              <p className="mx-auto mt-1 max-w-md text-xs text-neutral-400">
                Waypoints become ordered stops (a bare track is sampled into a few stops per day). Stops are grouped into days by date, by GPX
                route/track or KML folder, or 4 per day. StoryMap photos within 500 m fill in thumbnails and light phases.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()} disabled={Boolean(busy)} className="rounded-lg bg-amber-300 px-3 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-50">
                  Choose file…
                </button>
                {!draft && (
                  <button type="button" onClick={() => { setDraft(emptyDraft()); setDirty(true); }} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20">
                    Start from scratch
                  </button>
                )}
              </div>
              <input ref={fileRef} type="file" accept=".gpx,.kml,.json,application/gpx+xml,application/vnd.google-earth.kml+xml,application/json" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void importFile(f); }} />
            </section>
          )}

          {busy && <p className="rounded-lg bg-sky-500/10 px-3 py-2 text-sm text-sky-200">{busy}</p>}
          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          {notice && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">{notice}</p>}

          {draft && (
            <>
              {/* Details */}
              <section className="space-y-2.5">
                <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Details</h3>
                <label className="block text-xs text-neutral-400">
                  Title
                  <input value={draft.title} maxLength={140} onChange={(e) => update((d) => ({ ...d, title: e.target.value, slug: d.id || d.slug !== slugify(d.title) ? d.slug : slugify(e.target.value) }))} placeholder="Iceland South Coast in 5 Days" className={`${input} mt-1`} />
                </label>
                <div className="grid gap-2.5 sm:grid-cols-2">
                  <label className="block text-xs text-neutral-400">
                    Link slug <span className="text-neutral-500">(?route=…)</span>
                    <input value={draft.slug} maxLength={80} onChange={(e) => update((d) => ({ ...d, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-") }))} onBlur={() => update((d) => ({ ...d, slug: slugify(d.slug || d.title) }))} className={`${input} mt-1 font-mono text-xs`} />
                  </label>
                  <label className="block text-xs text-neutral-400">
                    Country
                    <input value={draft.country ?? ""} maxLength={60} onChange={(e) => update((d) => ({ ...d, country: e.target.value }))} placeholder="Iceland" className={`${input} mt-1`} />
                  </label>
                </div>
                <label className="block text-xs text-neutral-400">
                  Description
                  <textarea value={draft.description ?? ""} maxLength={2000} rows={2} onChange={(e) => update((d) => ({ ...d, description: e.target.value }))} placeholder="Short description for the route card" className={`${input} mt-1 resize-y`} />
                </label>
                <div className="flex gap-3">
                  <div className="h-16 w-24 shrink-0 overflow-hidden rounded-lg bg-neutral-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {draft.cover_url && <img src={draft.cover_url} alt="" className="h-full w-full object-cover" />}
                  </div>
                  <label className="block min-w-0 flex-1 text-xs text-neutral-400">
                    Cover image URL <span className="text-neutral-500">(empty = first stop photo)</span>
                    <input value={draft.cover_url ?? ""} onChange={(e) => update((d) => ({ ...d, cover_url: e.target.value }))} placeholder="https://…" className={`${input} mt-1 text-xs`} />
                  </label>
                </div>
                {thumbs.length > 1 && (
                  <div className="flex gap-1.5 overflow-x-auto pb-1" aria-label="Pick a cover from the stop photos">
                    {thumbs.map((t) => (
                      <button key={t} type="button" onClick={() => update((d) => ({ ...d, cover_url: t }))} title="Use as cover" className={`h-10 w-14 shrink-0 overflow-hidden rounded-md ring-2 ${draft.cover_url === t ? "ring-amber-300" : "ring-transparent hover:ring-white/40"}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={t} alt="" loading="lazy" className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.published} onChange={(e) => update((d) => ({ ...d, published: e.target.checked }))} className="h-4 w-4 accent-amber-300" />
                    Published <span className="text-xs text-neutral-500">(off = draft, admins only)</span>
                  </label>
                  <label className="flex items-center gap-2 text-xs text-neutral-400">
                    Sort order
                    <input type="number" value={draft.sort_order} onChange={(e) => update((d) => ({ ...d, sort_order: Number(e.target.value) || 0 }))} className={`${input} !w-20`} />
                    <span className="text-neutral-500">lower = first</span>
                  </label>
                </div>
              </section>

              {/* Days & stops */}
              <section className="space-y-3">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Days &amp; stops · {stops.length}</h3>
                  <button type="button" onClick={rematch} disabled={Boolean(busy) || !stops.length} className={`${small} ml-auto`} title="Fill missing thumbnails and light phases from StoryMap photos within 500 m">
                    📷 Match photos (500 m)
                  </button>
                  <button type="button" onClick={() => setDays((days) => [...days, { title: null, stops: [] }])} disabled={dayCount >= 60} className={small}>＋ Day</button>
                </div>
                {draft.plan.days.map((day, di) => (
                  <div key={di} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
                    <div className="mb-2 flex items-center gap-2">
                      <span className="shrink-0 text-sm font-semibold text-amber-300">Day {di + 1}</span>
                      <input value={day.title ?? ""} onChange={(e) => setDays((days) => days.map((d, i) => (i === di ? { ...d, title: e.target.value } : d)))} placeholder="Day title (optional)" aria-label={`Day ${di + 1} title`} className={`${input} !py-1 text-xs`} />
                      <button type="button" disabled={di === 0} onClick={() => setDays((days) => { const n = [...days]; [n[di - 1], n[di]] = [n[di], n[di - 1]]; return n; })} className={small} aria-label="Move day up">↑</button>
                      <button type="button" disabled={di === dayCount - 1} onClick={() => setDays((days) => { const n = [...days]; [n[di + 1], n[di]] = [n[di], n[di + 1]]; return n; })} className={small} aria-label="Move day down">↓</button>
                      <button
                        type="button"
                        disabled={dayCount === 1}
                        onClick={() => { if (!day.stops.length || window.confirm(`Delete day ${di + 1} and its ${day.stops.length} stops?`)) setDays((days) => days.filter((_, i) => i !== di)); }}
                        className={`${small} hover:!bg-red-500/30`}
                        aria-label={`Delete day ${di + 1}`}
                      >
                        ✕
                      </button>
                    </div>

                    <ol className="space-y-1.5">
                      {day.stops.map((s, si) => {
                        const key = `${di}-${si}`;
                        const expanded = openStop === key;
                        return (
                          <li key={key} className="rounded-xl bg-black/30 p-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="w-5 shrink-0 text-center text-xs font-bold text-neutral-400">{si + 1}</span>
                              <div className="h-8 w-10 shrink-0 overflow-hidden rounded bg-neutral-800">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                {s.thumb && <img src={s.thumb} alt="" loading="lazy" className="h-full w-full object-cover" />}
                              </div>
                              <input value={s.name} onChange={(e) => patchStop(di, si, { name: e.target.value })} aria-label="Stop name" className={`${input} min-w-0 !py-1 text-xs`} />
                              <select value={s.light ?? ""} onChange={(e) => patchStop(di, si, { light: (e.target.value || null) as LightPhase | null })} aria-label="Light phase" className={`${input} !w-auto shrink-0 !py-1 text-xs`}>
                                <option value="">No light</option>
                                {LIGHT_PHASES.map((p) => <option key={p} value={p}>{LIGHT_ICON[p]} {p}</option>)}
                              </select>
                              {dayCount > 1 && (
                                <select
                                  value={di}
                                  onChange={(e) => {
                                    const to = Number(e.target.value);
                                    setDays((days) => days.map((d, i) => (i === di ? { ...d, stops: d.stops.filter((_, j) => j !== si) } : i === to ? { ...d, stops: [...d.stops, s] } : d)));
                                    setOpenStop(null);
                                  }}
                                  aria-label="Move to day"
                                  title="Move to another day"
                                  className={`${input} !w-auto shrink-0 !py-1 text-xs max-sm:hidden`}
                                >
                                  {draft.plan.days.map((_, i) => <option key={i} value={i}>Day {i + 1}</option>)}
                                </select>
                              )}
                              <button type="button" disabled={si === 0} onClick={() => setStops(di, (st) => { const n = [...st]; [n[si - 1], n[si]] = [n[si], n[si - 1]]; return n; })} className={small} aria-label="Move stop up">↑</button>
                              <button type="button" disabled={si === day.stops.length - 1} onClick={() => setStops(di, (st) => { const n = [...st]; [n[si + 1], n[si]] = [n[si], n[si + 1]]; return n; })} className={small} aria-label="Move stop down">↓</button>
                              <button type="button" onClick={() => setOpenStop(expanded ? null : key)} aria-expanded={expanded} className={small} aria-label="Stop details">{expanded ? "▾" : "▸"}</button>
                              <button type="button" onClick={() => { setStops(di, (st) => st.filter((_, j) => j !== si)); setOpenStop(null); }} className={`${small} hover:!bg-red-500/30`} aria-label={`Delete stop ${s.name}`}>✕</button>
                            </div>
                            {expanded && (
                              <div className="mt-2 grid gap-2 px-1 pb-1 sm:grid-cols-2">
                                <label className="text-[11px] text-neutral-400 sm:col-span-2">
                                  Description
                                  <textarea value={s.description ?? ""} rows={2} maxLength={1000} onChange={(e) => patchStop(di, si, { description: e.target.value || null })} className={`${input} mt-0.5 resize-y text-xs`} />
                                </label>
                                <label className="text-[11px] text-neutral-400 sm:col-span-2">
                                  Logistics <span className="text-neutral-500">(parking, access, drone rules…)</span>
                                  <input value={s.logistics ?? ""} maxLength={500} onChange={(e) => patchStop(di, si, { logistics: e.target.value || null })} className={`${input} mt-0.5 text-xs`} />
                                </label>
                                <label className="text-[11px] text-neutral-400">
                                  Latitude
                                  <input type="number" step="any" value={s.latitude} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && Math.abs(v) <= 90) patchStop(di, si, { latitude: v }); }} className={`${input} mt-0.5 text-xs`} />
                                </label>
                                <label className="text-[11px] text-neutral-400">
                                  Longitude
                                  <input type="number" step="any" value={s.longitude} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v) && Math.abs(v) <= 180) patchStop(di, si, { longitude: v }); }} className={`${input} mt-0.5 text-xs`} />
                                </label>
                                <label className="text-[11px] text-neutral-400">
                                  Photo URL
                                  <input value={s.thumb ?? ""} onChange={(e) => patchStop(di, si, { thumb: e.target.value || null })} placeholder="https://…" className={`${input} mt-0.5 text-xs`} />
                                </label>
                                <label className="text-[11px] text-neutral-400">
                                  Time at stop (min)
                                  <input type="number" min={5} max={720} value={s.durationMinutes ?? 60} onChange={(e) => patchStop(di, si, { durationMinutes: Math.max(5, Math.min(720, Number(e.target.value) || 60)) })} className={`${input} mt-0.5 text-xs`} />
                                </label>
                                {dayCount > 1 && (
                                  <label className="text-[11px] text-neutral-400 sm:hidden">
                                    Day
                                    <select value={di} onChange={(e) => { const to = Number(e.target.value); setDays((days) => days.map((d, i) => (i === di ? { ...d, stops: d.stops.filter((_, j) => j !== si) } : i === to ? { ...d, stops: [...d.stops, s] } : d))); setOpenStop(null); }} className={`${input} mt-0.5 text-xs`}>
                                      {draft.plan.days.map((_, i) => <option key={i} value={i}>Day {i + 1}</option>)}
                                    </select>
                                  </label>
                                )}
                              </div>
                            )}
                          </li>
                        );
                      })}
                    </ol>

                    <form
                      className="mt-2 flex flex-wrap items-center gap-1.5"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const ll = parseLatLng(coords[di] ?? "");
                        if (!ll) return setError("Enter coordinates as latitude, longitude, e.g. 63.5321, -19.5114");
                        setError(null);
                        void addStopAt(di, ll);
                        setCoords((c) => ({ ...c, [di]: "" }));
                      }}
                    >
                      <input value={coords[di] ?? ""} onChange={(e) => setCoords((c) => ({ ...c, [di]: e.target.value }))} placeholder="Add stop: lat, lng" aria-label={`Add a stop to day ${di + 1} by coordinates`} className={`${input} !w-48 !py-1 font-mono text-xs`} />
                      <button type="submit" className={small}>＋ Add</button>
                      <button type="button" onClick={() => { setPicked(null); setPickingDay(di); startPick(); }} className={small}>📍 Pick on map</button>
                    </form>
                  </div>
                ))}
              </section>

              {/* Pro tips */}
              <section className="space-y-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-400">Pro tips · {draft.tips.length}</h3>
                  <span className="text-[11px] text-neutral-500">the first 3 are public, the rest unlock with sign-in</span>
                  <button type="button" onClick={() => update((d) => ({ ...d, tips: [...d.tips, { kind: "photo", text: "", stop: null }] }))} className={`${small} ml-auto`}>＋ Tip</button>
                </div>
                {draft.tips.map((t, ti) => (
                  <div key={ti} className="flex flex-wrap items-center gap-1.5 rounded-xl bg-white/[0.03] p-1.5 sm:flex-nowrap">
                    <select value={t.kind} onChange={(e) => update((d) => ({ ...d, tips: d.tips.map((x, i) => (i === ti ? { ...x, kind: e.target.value as TipKind } : x)) }))} aria-label="Tip type" className={`${input} !w-auto !py-1 text-xs`}>
                      {TIP_KINDS.map((k) => <option key={k} value={k}>{TIP_ICON[k]} {k}</option>)}
                    </select>
                    <input value={t.text} maxLength={500} onChange={(e) => update((d) => ({ ...d, tips: d.tips.map((x, i) => (i === ti ? { ...x, text: e.target.value } : x)) }))} placeholder="Bring a 10-stop ND filter for the falls" aria-label="Tip text" className={`${input} min-w-0 flex-1 !py-1 text-xs`} />
                    <select value={t.stop ?? ""} onChange={(e) => update((d) => ({ ...d, tips: d.tips.map((x, i) => (i === ti ? { ...x, stop: e.target.value || null } : x)) }))} aria-label="Tip stop" className={`${input} !w-32 !py-1 text-xs`}>
                      <option value="">Whole route</option>
                      {t.stop && !stops.some((s) => s.name === t.stop) && <option value={t.stop}>{t.stop}</option>}
                      {[...new Set(stops.map((s) => s.name))].map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                    <button type="button" disabled={ti === 0} onClick={() => update((d) => { const n = [...d.tips]; [n[ti - 1], n[ti]] = [n[ti], n[ti - 1]]; return { ...d, tips: n }; })} className={small} aria-label="Move tip up">↑</button>
                    <button type="button" disabled={ti === draft.tips.length - 1} onClick={() => update((d) => { const n = [...d.tips]; [n[ti + 1], n[ti]] = [n[ti], n[ti + 1]]; return { ...d, tips: n }; })} className={small} aria-label="Move tip down">↓</button>
                    <button type="button" onClick={() => update((d) => ({ ...d, tips: d.tips.filter((_, i) => i !== ti) }))} className={`${small} hover:!bg-red-500/30`} aria-label="Delete tip">✕</button>
                  </div>
                ))}
              </section>
            </>
          )}
        </div>

        {draft && (
          <div className="flex flex-wrap items-center gap-2 border-t border-white/10 px-5 py-3">
            {draft.id && (
              <button type="button" onClick={remove} disabled={Boolean(busy)} className="rounded-lg bg-red-500/15 px-3 py-1.5 text-sm font-semibold text-red-200 hover:bg-red-500/25 disabled:opacity-50">
                🗑 Delete
              </button>
            )}
            <button type="button" onClick={openInPlanner} disabled={Boolean(busy) || !stops.length} className="rounded-lg bg-white/10 px-3 py-1.5 text-sm font-semibold hover:bg-white/20 disabled:opacity-50" title="Load the route into the Trip Planner to edit it on the map, then re-publish">
              🧭 Open in Trip Planner
            </button>
            <button type="button" onClick={tryClose} className="ml-auto rounded-lg px-3 py-1.5 text-sm text-neutral-300 hover:text-white">Cancel</button>
            <button type="button" onClick={save} disabled={Boolean(busy)} className="rounded-lg bg-amber-300 px-4 py-1.5 text-sm font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-50">
              {busy === "Saving…" ? "Saving…" : draft.id ? "Save changes" : "Create route"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
