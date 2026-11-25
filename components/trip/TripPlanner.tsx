"use client";

import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-map-gl";
import type { User } from "@supabase/supabase-js";
import LocationAutocomplete from "@/components/LocationAutocomplete";
import { MAP_ID } from "@/components/map/constants";
import { useTripStore } from "@/store/tripStore";
import { getAllPins, boundsOf, type Pin } from "@/lib/pins";
import { BUCKETS, DAY_COLORS, DEFAULT_START, daySchedule, dbSuggestions, formatDay, parseClock, scheduleText, uid, whatsappItinerary, whatsappUrl, type SpotBucket, type SpotSuggestion, type Stop, type TripDay } from "@/lib/trip";
import { generateTripRoute, suggestPhotoSpots, type ScoutSpotDto } from "@/lib/aiClient";
import { exportTripXlsx } from "@/lib/tripExcel";
import { useMapStore } from "@/store/mapStore";
import StopCard from "./StopCard";
import { deleteTrip, listTrips, loadTrip, saveTrip, type SavedTrip } from "@/lib/tripApi";
import { googleMapsRouteUrl } from "@/hooks/useCollectionPhotos";
import type { PlaceSuggestion } from "@/lib/geocode";
import { routeShareUrl, slugify, type RouteTip, type TipKind } from "@/lib/readyRoutes";
import { tripToRoute } from "@/lib/readyRoutesTrip";
import { publishReadyRoute, slugTaken } from "@/lib/readyRoutesApi";
import { useRoutesStore } from "@/store/routesStore";

const inputCls = "rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-amber-300";
const smallBtn = "rounded-lg bg-white/10 px-2.5 py-1 max-md:min-h-10 text-xs font-medium text-neutral-100 hover:bg-white/20 disabled:opacity-40";

const SCOUT_LABEL: Record<ScoutSpotDto["phase"], string> = { sunrise: "🌅 Sunrise", sunset: "🌇 Sunset / Golden Hour", midday: "☀️ Midday" };

/** "Plan a Photo Trip": dates → day cards → multi-stop days with exact solar times and photo-spot recommendations */
export default function TripPlanner({ user, onRequireLogin, isAdmin = false }: { user: User | null; onRequireLogin: () => void; isAdmin?: boolean }) {
  const { [MAP_ID]: map } = useMap();
  const open = useTripStore((s) => s.open);
  const setOpen = useTripStore((s) => s.setOpen);
  const trip = useTripStore((s) => s.trip);
  const setTrip = useTripStore((s) => s.setTrip);
  const setName = useTripStore((s) => s.setName);
  const setDates = useTripStore((s) => s.setDates);
  const addStop = useTripStore((s) => s.addStop);
  const removeStop = useTripStore((s) => s.removeStop);
  const moveStop = useTripStore((s) => s.moveStop);
  const reset = useTripStore((s) => s.reset);
  const updateStop = useTripStore((s) => s.updateStop);
  const addStops = useTripStore((s) => s.addStops);
  const setDayStart = useTripStore((s) => s.setDayStart);
  const setMapMode = useMapStore((s) => s.setMapMode);

  const [pins, setPins] = useState<Pin[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<SavedTrip[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [spotsOpen, setSpotsOpen] = useState<Record<number, boolean>>({});
  const [ai, setAi] = useState<Record<string, { loading: boolean; spots?: ScoutSpotDto[]; error?: string }>>({});
  /** Double-width drawer on desktop (compact toggle) */
  const [wide, setWide] = useState(true);
  const [activeDay, setActiveDay] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [planning, setPlanning] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  /** Owner-only "Publish to Ready Routes" form */
  const [pub, setPub] = useState<{ title: string; slug: string; slugEdited: boolean; description: string; tips: string; country: string; keep?: { published: boolean; sort_order: number } } | null>(null);
  // "Open in Trip Planner" from the Ready Routes editor: prefill the publish form with the route details
  const prefill = useRoutesStore((s) => s.plannerPrefill);
  const setPrefill = useRoutesStore((s) => s.setPlannerPrefill);
  useEffect(() => {
    if (!prefill) return;
    setPub({ title: prefill.title, slug: prefill.slug, slugEdited: true, description: prefill.description, tips: prefill.tips, country: prefill.country, keep: { published: prefill.published, sort_order: prefill.sort_order } });
    setPrefill(null);
  }, [prefill, setPrefill]);
  const [publishing, setPublishing] = useState(false);

  // The planner works on the road map: switch to Streets while it is open, put the user's style back when it closes
  useEffect(() => {
    if (!open) return;
    const before = useMapStore.getState().mapMode;
    if (before !== "streets") setMapMode("streets");
    return () => {
      if (useMapStore.getState().mapMode === "streets" && before !== "streets") setMapMode(before);
    };
  }, [open, setMapMode]);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getAllPins().then((p) => alive && setPins(p)).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [open]);

  const fitStops = (stops: { latitude: number; longitude: number }[]) => {
    const box = boundsOf(stops);
    if (!map || !box) return;
    if (stops.length === 1) map.flyTo({ center: box[0], zoom: Math.max(map.getZoom(), 11), duration: 1200, essential: true });
    else map.fitBounds(box, { padding: { top: 120, bottom: 80, left: 80, right: wide ? 860 : 440 }, maxZoom: 13, duration: 1200 });
  };
  const allStops = useMemo(() => trip.days.flatMap((d) => d.stops), [trip.days]);

  const flash = (kind: "ok" | "err", text: string) => {
    setMsg({ kind, text });
    setTimeout(() => setMsg((m) => (m?.text === text ? null : m)), 4000);
  };

  const pickPlace = (dayIdx: number, s: PlaceSuggestion) => {
    const stop: Stop = { id: uid(), name: s.name, latitude: s.latitude, longitude: s.longitude, source: "search" };
    addStop(dayIdx, stop);
    setDrafts((d) => ({ ...d, [dayIdx]: "" }));
    fitStops([...trip.days[dayIdx].stops, stop]);
  };

  const addSuggestion = (dayIdx: number, s: SpotSuggestion) =>
    addStop(dayIdx, { id: uid(), name: s.name, latitude: s.latitude, longitude: s.longitude, source: "storymap", thumb: s.thumb, note: `${BUCKETS.find((b) => b.key === s.bucket)?.label} · ${s.photoCount} StoryMap photo${s.photoCount === 1 ? "" : "s"}` });

  const addScout = (dayIdx: number, s: ScoutSpotDto) =>
    addStop(dayIdx, { id: uid(), name: s.name, latitude: s.latitude, longitude: s.longitude, source: "ai", note: [SCOUT_LABEL[s.phase].replace(/^\S+\s/, ""), s.reason].filter(Boolean).join(" · ") });

  const runScout = async (dayIdx: number, day: TripDay) => {
    if (!user) return onRequireLogin();
    const key = `${dayIdx}|${day.stops.map((s) => s.id).join(",")}`;
    setAi((a) => ({ ...a, [key]: { loading: true } }));
    try {
      const spots = await suggestPhotoSpots(day.date, day.stops.map((s) => ({ name: s.name, latitude: s.latitude, longitude: s.longitude })));
      setAi((a) => ({ ...a, [key]: { loading: false, spots, error: spots.length ? undefined : "The scout found nothing for this route. Try adding another stop." } }));
    } catch (e) {
      setAi((a) => ({ ...a, [key]: { loading: false, error: e instanceof Error ? e.message : "AI suggestions failed" } }));
    }
  };

  const doSave = async () => {
    if (!user) return onRequireLogin();
    setBusy("save");
    try {
      const id = await saveTrip(trip, user.id);
      setTrip({ ...trip, id });
      setSaved(null);
      flash("ok", "Trip saved");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Could not save (is migration 009 applied?)");
    } finally {
      setBusy(null);
    }
  };

  const showSaved = async () => {
    if (!user) return onRequireLogin();
    if (saved) return setSaved(null);
    setBusy("list");
    try {
      setSaved(await listTrips());
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Could not load your trips");
    } finally {
      setBusy(null);
    }
  };

  const doLoad = async (id: string) => {
    setBusy("load");
    try {
      const t = await loadTrip(id);
      setTrip(t);
      setSaved(null);
      setSpotsOpen({});
      setAi({});
      fitStops(t.days.flatMap((d) => d.stops));
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Could not open the trip");
    } finally {
      setBusy(null);
    }
  };

  const doDelete = async (id: string) => {
    if (!window.confirm("Delete this saved trip?")) return;
    try {
      await deleteTrip(id);
      setSaved((s) => s?.filter((t) => t.id !== id) ?? null);
      if (trip.id === id) setTrip({ ...trip, id: undefined });
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Could not delete");
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(scheduleText(trip));
      flash("ok", "Schedule copied");
    } catch {
      flash("err", "Copy blocked by the browser: use Download");
    }
  };

  const exportXlsx = async () => {
    setXlsxBusy(true);
    try {
      await exportTripXlsx(trip);
      flash("ok", "Excel file downloaded");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Could not build the Excel file");
    } finally {
      setXlsxBusy(false);
    }
  };

  const planWithAi = async () => {
    if (!user) return onRequireLogin();
    const text = prompt.trim();
    if (text.length < 3) return flash("err", "Describe the day you want first");
    const di = Math.min(activeDay, trip.days.length - 1);
    const day = trip.days[di];
    if (!day) return;
    setPlanning(true);
    try {
      const c = map?.getCenter();
      const route = await generateTripRoute(text, day.date, c ? { latitude: c.lat, longitude: c.lng } : null);
      const stops: Stop[] = route.stops.map((r) => ({
        id: uid(),
        name: r.name,
        latitude: r.latitude,
        longitude: r.longitude,
        source: "ai",
        description: r.description,
        durationMinutes: r.durationMinutes,
        logistics: r.logistics,
        transitMinutes: r.transitMinutes,
        transitNote: r.transitNote,
      }));
      if (!day.stops.length) setDayStart(di, route.startTime);
      else stops[0] = { ...stops[0], transitMinutes: stops[0].transitMinutes || 15 };
      addStops(di, stops);
      if (route.title && trip.name === "My photo trip") setName(route.title);
      setMapMode("streets");
      fitStops([...day.stops, ...stops]);
      flash("ok", `Added ${stops.length} stops to Day ${di + 1}`);
      setPrompt("");
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "The AI assistant failed");
    } finally {
      setPlanning(false);
    }
  };

  /** "parking: …" / "drone: …" / anything else = photo tip, one per line */
  const parseTips = (text: string): RouteTip[] =>
    text
      .split(/\n+/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const m = /^(parking|drone|photo)\s*:\s*(.+)$/i.exec(l);
        return { kind: (m ? m[1].toLowerCase() : "photo") as TipKind, text: (m ? m[2] : l).slice(0, 500) };
      });

  const publishRoute = async () => {
    if (!pub || !isAdmin) return;
    const slug = slugify(pub.slug || pub.title);
    if (!pub.title.trim()) return flash("err", "Give the route a title");
    if (!allStops.length) return flash("err", "Add stops first");
    setPublishing(true);
    try {
      if ((await slugTaken(slug)) && !window.confirm(`A Ready Route with the link "${slug}" already exists. Replace it?`)) return;
      const saved = await publishReadyRoute({ ...tripToRoute(trip, { title: pub.title, slug, description: pub.description, tips: parseTips(pub.tips), country: pub.country }), ...(pub.keep ?? {}) });
      useRoutesStore.getState().bump();
      const url = routeShareUrl(saved.slug, undefined, window.location.origin);
      void navigator.clipboard?.writeText(url).catch(() => undefined);
      flash("ok", `Published to Ready Routes: ${url} (link copied)`);
      setPub(null);
    } catch (e) {
      flash("err", e instanceof Error ? e.message : "Could not publish");
    } finally {
      setPublishing(false);
    }
  };

  const copyItinerary = async () => {
    try {
      await navigator.clipboard.writeText(whatsappItinerary(trip));
      flash("ok", "Copied!");
    } catch {
      flash("err", "Copy blocked by the browser");
    }
  };

  const sendWhatsApp = () => {
    window.open(whatsappUrl(whatsappItinerary(trip)), "_blank", "noopener,noreferrer");
  };

  const download = () => {
    const blob = new Blob([scheduleText(trip)], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${trip.name.replace(/[^\w-]+/g, "_") || "photo-trip"}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  if (!open) return null;

  return (
    <aside
      aria-label="Plan a Photo Trip"
      className={`pointer-events-auto absolute inset-x-2 top-[4.5rem] z-30 flex max-h-[70dvh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/95 text-neutral-100 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-4 md:right-4 md:top-24 md:max-h-none ${wide ? "md:w-[min(820px,calc(100vw-2rem))]" : "md:w-[400px]"}`}
    >
      <div className="flex items-start justify-between gap-2 border-b border-white/10 px-4 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold">🧭 Plan a Photo Trip</h2>
          <input
            value={trip.name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Trip name"
            maxLength={120}
            className="mt-1 w-full rounded-md border border-transparent bg-transparent px-1 py-0.5 text-sm text-neutral-200 outline-none hover:border-white/10 focus:border-amber-300"
          />
        </div>
        <button type="button" onClick={() => setWide((w) => !w)} aria-label={wide ? "Collapse trip planner" : "Expand trip planner"} title={wide ? "Collapse" : "Expand"} className="hidden h-7 w-7 items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 hover:text-white md:flex">{wide ? "⇥" : "⇤"}</button>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close trip planner" className="text-xl leading-none text-neutral-400 hover:text-white">×</button>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 py-3">
        {/* Dates */}
        <div className="grid grid-cols-2 gap-2">
          <label className="text-[11px] text-neutral-400">
            Start date
            <input type="date" value={trip.startDate} onChange={(e) => e.target.value && setDates(e.target.value, e.target.value > trip.endDate ? e.target.value : trip.endDate)} className={`${inputCls} mt-0.5 w-full [color-scheme:dark]`} />
          </label>
          <label className="text-[11px] text-neutral-400">
            End date
            <input type="date" value={trip.endDate} min={trip.startDate} onChange={(e) => e.target.value && setDates(trip.startDate, e.target.value)} className={`${inputCls} mt-0.5 w-full [color-scheme:dark]`} />
          </label>
        </div>

        {/* AI Trip Assistant */}
        <div className="rounded-2xl border border-amber-300/25 bg-amber-300/[0.06] p-3">
          <label className="text-xs font-semibold text-amber-100" htmlFor="trip-ai-prompt">✨ AI Trip Assistant</label>
          <textarea
            id="trip-ai-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === "Enter" && void planWithAi()}
            rows={2}
            maxLength={600}
            placeholder="I'm traveling tomorrow in Tbilisi, build me an organized sunrise-to-sunset route with the most photogenic spots"
            className={`${inputCls} mt-1.5 w-full resize-y`}
          />
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {trip.days.length > 1 && (
              <label className="text-[11px] text-neutral-400">
                Add to{" "}
                <select value={Math.min(activeDay, trip.days.length - 1)} onChange={(e) => setActiveDay(Number(e.target.value))} className="rounded-md border border-white/10 bg-neutral-900 px-1.5 py-1 text-xs text-white">
                  {trip.days.map((d, i) => <option key={d.date + i} value={i}>Day {i + 1} · {formatDay(d.date)}</option>)}
                </select>
              </label>
            )}
            <button type="button" onClick={planWithAi} disabled={planning} className="ml-auto rounded-xl bg-amber-300 px-4 py-2 text-xs font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-60 max-md:min-h-11">
              {planning ? "Building your route…" : "Build my route"}
            </button>
          </div>
        </div>

        {/* Share: WhatsApp-formatted itinerary with one-tap Google Maps links */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={sendWhatsApp}
            disabled={!allStops.length}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-[#25D366] px-3 text-sm font-semibold text-neutral-950 hover:brightness-110 disabled:opacity-40"
          >
            <span aria-hidden>💬</span> Send to WhatsApp
          </button>
          <button
            type="button"
            onClick={copyItinerary}
            disabled={!allStops.length}
            className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 text-sm font-semibold text-neutral-100 hover:bg-white/20 disabled:opacity-40"
          >
            <span aria-hidden>📋</span> Copy Itinerary
          </button>
        </div>
        {!allStops.length && <p className="-mt-1 text-[11px] text-neutral-500">Add a stop to share the itinerary.</p>}

        {/* Save / load / export */}
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={smallBtn} onClick={doSave} disabled={busy === "save"}>{busy === "save" ? "Saving…" : trip.id ? "💾 Save changes" : "💾 Save trip"}</button>
          <button type="button" className={smallBtn} onClick={showSaved} disabled={busy === "list"}>📂 My trips</button>
          <button type="button" className={smallBtn} onClick={copy}>📋 Copy schedule</button>
          <button type="button" className={smallBtn} onClick={download}>⬇ Download</button>
          <button type="button" className={`${smallBtn} !bg-emerald-400/20 !text-emerald-100 hover:!bg-emerald-400/30`} onClick={exportXlsx} disabled={!allStops.length || xlsxBusy}>{xlsxBusy ? "Building…" : "📊 Export Excel (.xlsx)"}</button>
          <button type="button" className={smallBtn} onClick={() => { if (!allStops.length || window.confirm("Start a new trip? Unsaved changes are lost.")) { reset(); setSpotsOpen({}); setAi({}); } }}>＋ New</button>
          {allStops.length > 0 && <button type="button" className={smallBtn} onClick={() => fitStops(allStops)}>⤢ Fit</button>}
          {isAdmin && (
            <button
              type="button"
              className={`${smallBtn} !bg-sky-400/20 !text-sky-100 hover:!bg-sky-400/30`}
              disabled={!allStops.length}
              onClick={() => setPub((v) => (v ? null : { title: trip.name, slug: slugify(trip.name), slugEdited: false, description: "", tips: "", country: "" }))}
              title="Owner only: save this plan to the public Ready Routes library"
            >
              🗺️ Publish to Ready Routes
            </button>
          )}
        </div>
        {isAdmin && pub && (
          <div className="space-y-2 rounded-2xl border border-sky-300/25 bg-sky-300/[0.06] p-3">
            <p className="text-xs font-semibold text-sky-100">Publish to Ready Routes</p>
            <input value={pub.title} onChange={(e) => setPub({ ...pub, title: e.target.value, slug: pub.slugEdited ? pub.slug : slugify(e.target.value) })} maxLength={140} placeholder="Title, e.g. Iceland South Coast in 5 Days" aria-label="Route title" className={`${inputCls} w-full`} />
            <div className="flex items-center gap-1 text-[11px] text-neutral-400">
              <span className="shrink-0">/?route=</span>
              <input value={pub.slug} onChange={(e) => setPub({ ...pub, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"), slugEdited: true })} maxLength={80} aria-label="Route link slug" className={`${inputCls} min-w-0 flex-1 !py-1 !text-xs`} />
            </div>
            <input value={pub.country} onChange={(e) => setPub({ ...pub, country: e.target.value })} maxLength={60} placeholder="Country (auto-detected when empty)" aria-label="Country" className={`${inputCls} w-full`} />
            <textarea value={pub.description} onChange={(e) => setPub({ ...pub, description: e.target.value })} rows={2} maxLength={2000} placeholder="Short description for the route card" aria-label="Route description" className={`${inputCls} w-full resize-y`} />
            <textarea value={pub.tips} onChange={(e) => setPub({ ...pub, tips: e.target.value })} rows={3} maxLength={6000} placeholder={"Pro tips, one per line (the first 3 are public):\nBring a 10-stop ND filter for the falls\nparking: Free lot 200 m before the trailhead\ndrone: No-fly zone inside the national park"} aria-label="Pro tips" className={`${inputCls} w-full resize-y text-xs`} />
            <p className="text-[11px] text-neutral-400">{trip.days.filter((d) => d.stops.length).length} days · {allStops.length} stops. Light per stop is set from each stop&apos;s planned arrival time.</p>
            <div className="flex justify-end gap-2">
              <button type="button" className={smallBtn} onClick={() => setPub(null)}>Cancel</button>
              <button type="button" onClick={publishRoute} disabled={publishing} className="rounded-lg bg-sky-300 px-3 py-1 text-xs font-semibold text-neutral-900 hover:bg-sky-200 disabled:opacity-50 max-md:min-h-10">
                {publishing ? "Publishing…" : "Publish"}
              </button>
            </div>
          </div>
        )}
        {msg && <p className={`rounded-lg px-3 py-1.5 text-xs ${msg.kind === "ok" ? "bg-emerald-950/70 text-emerald-200" : "bg-red-950/70 text-red-200"}`}>{msg.text}</p>}

        {saved && (
          <div className="rounded-xl bg-white/5 p-2">
            {saved.length === 0 ? (
              <p className="px-2 py-1 text-xs text-neutral-400">No saved trips yet.</p>
            ) : (
              <ul className="space-y-0.5">
                {saved.map((t) => (
                  <li key={t.id} className="flex items-center gap-1">
                    <button type="button" onClick={() => doLoad(t.id)} className="min-w-0 flex-1 rounded-lg px-2 py-1 text-start hover:bg-white/10">
                      <span className="block truncate text-xs font-medium">{t.name}</span>
                      <span className="block text-[10px] text-neutral-500">{t.start_date} → {t.end_date}</span>
                    </button>
                    <button type="button" onClick={() => doDelete(t.id)} aria-label={`Delete ${t.name}`} className="rounded-md px-1.5 text-neutral-500 hover:bg-white/10 hover:text-red-300">🗑</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* Days */}
        {trip.days.map((day, di) => {
          const color = DAY_COLORS[di % DAY_COLORS.length];
          const suggestions = spotsOpen[di] ? dbSuggestions(pins, day.stops) : null;
          const aiKey = `${di}|${day.stops.map((s) => s.id).join(",")}`;
          const aiState = ai[aiKey];
          const mapsUrl = day.stops.length ? googleMapsRouteUrl(day.stops) : null;
          const proximity = day.stops[day.stops.length - 1] ?? trip.days.slice(0, di).flatMap((d) => d.stops).pop() ?? null;
          const timed = daySchedule(day);
          const dbTotal = suggestions ? BUCKETS.reduce((n, b) => n + suggestions[b.key].length, 0) : 0;
          return (
            <section key={day.date + di} onFocusCapture={() => setActiveDay(di)} onClick={() => setActiveDay(di)} className={`rounded-2xl border bg-white/[0.03] p-3 ${di === Math.min(activeDay, trip.days.length - 1) ? "border-white/25" : "border-white/10"}`}>
              <header className="mb-2 flex flex-wrap items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
                <h3 className="text-sm font-semibold">Day {di + 1} <span className="font-normal text-neutral-400">- {formatDay(day.date)}</span></h3>
                <label className="ml-auto flex items-center gap-1.5 text-[11px] text-neutral-400">
                  Start time
                  <input
                    type="time"
                    value={day.startTime ?? DEFAULT_START}
                    onChange={(e) => parseClock(e.target.value) !== null && setDayStart(di, e.target.value)}
                    aria-label={`Day ${di + 1} start time`}
                    className="rounded-md border border-white/10 bg-neutral-900 px-1.5 py-1 font-mono text-xs text-white [color-scheme:dark]"
                  />
                </label>
                {mapsUrl && day.stops.length > 1 && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="text-[11px] text-amber-200 hover:underline">Google Maps ↗</a>
                )}
              </header>

              <ol className="space-y-2">
                {day.stops.map((s, si) => (
                  <StopCard
                    key={s.id}
                    stop={s}
                    index={si}
                    count={day.stops.length}
                    color={color}
                    timed={timed[si]}
                    pins={pins}
                    date={day.date}
                    onPatch={(patch) => updateStop(di, s.id, patch)}
                    onMove={(to) => moveStop(di, si, to)}
                    onRemove={() => removeStop(di, s.id)}
                    onLocate={() => map?.flyTo({ center: [s.longitude, s.latitude], zoom: Math.max(map.getZoom(), 12), duration: 1000, essential: true })}
                    onNotice={flash}
                  />
                ))}
              </ol>

              <div className="mt-2">
                <LocationAutocomplete
                  value={drafts[di] ?? ""}
                  onChange={(t) => setDrafts((d) => ({ ...d, [di]: t }))}
                  onSelect={(s) => pickPlace(di, s)}
                  proximity={proximity}
                  theme="dark"
                  placeholder={day.stops.length ? "Add another stop…" : "Add a place (e.g. Marienplatz Munich)…"}
                  ariaLabel={`Add a stop to day ${di + 1}`}
                  inputClassName={`${inputCls} w-full`}
                />
              </div>

              {/* Photo spots along the route */}
              {day.stops.length > 0 && (
                <div className="mt-2">
                  <button type="button" onClick={() => setSpotsOpen((o) => ({ ...o, [di]: !o[di] }))} aria-expanded={Boolean(spotsOpen[di])} className="flex w-full items-center justify-between rounded-lg bg-white/5 px-2.5 py-1.5 text-xs font-semibold hover:bg-white/10">
                    <span>📸 Photo spots along this route</span>
                    <span className="text-neutral-400">{spotsOpen[di] ? "−" : "+"}</span>
                  </button>

                  {spotsOpen[di] && suggestions && (
                    <div className="mt-2 space-y-2">
                      {dbTotal === 0 ? (
                        <p className="rounded-lg bg-white/5 px-3 py-2 text-[11px] text-neutral-400">StoryMap has no photos near this route yet. Try the AI scout below.</p>
                      ) : (
                        BUCKETS.map((b) => (
                          <SpotGroup key={b.key} bucket={b.key} label={`${b.icon} ${b.label}`} items={suggestions[b.key]} onAdd={(s) => addSuggestion(di, s)} onOpen={(s) => {
                            map?.flyTo({ center: [s.longitude, s.latitude], zoom: Math.max(map.getZoom(), 13), duration: 1000, essential: true });
                          }} />
                        ))
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    onClick={() => runScout(di, day)}
                    disabled={aiState?.loading}
                    className="mt-2 w-full rounded-xl bg-amber-300 px-3 py-2 text-xs font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-60"
                  >
                    {aiState?.loading ? "Scouting locations…" : "✨ Suggest Photo Spots with AI"}
                  </button>
                  {aiState?.error && <p className="mt-1.5 rounded-lg bg-red-950/60 px-3 py-1.5 text-[11px] text-red-200">{aiState.error}</p>}
                  {aiState?.spots && aiState.spots.length > 0 && (
                    <div className="mt-2 space-y-2">
                      <p className="text-[10px] text-neutral-500">AI suggestions: check the exact location before you go.</p>
                      {(["sunrise", "sunset", "midday"] as const).map((ph) => {
                        const list = aiState.spots!.filter((s) => s.phase === ph);
                        if (!list.length) return null;
                        return (
                          <div key={ph}>
                            <h4 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{SCOUT_LABEL[ph]}</h4>
                            <ul className="space-y-1">
                              {list.map((s) => (
                                <li key={s.name} className="flex items-start gap-2 rounded-xl bg-neutral-900/80 p-2">
                                  <button type="button" onClick={() => map?.flyTo({ center: [s.longitude, s.latitude], zoom: Math.max(map.getZoom(), 13), duration: 1000, essential: true })} className="min-w-0 flex-1 text-start">
                                    <span className="block truncate text-xs font-semibold" dir="auto">{s.name}</span>
                                    {s.reason && <span className="line-clamp-2 text-[10px] text-neutral-400">{s.reason}</span>}
                                  </button>
                                  <button type="button" onClick={() => addScout(di, s)} className="shrink-0 rounded-lg bg-amber-300 px-2 py-1 text-[11px] font-semibold text-neutral-900 hover:bg-amber-200">+ Add to Day</button>
                                </li>
                              ))}
                            </ul>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </aside>
  );
}

function SpotGroup({ bucket, label, items, onAdd, onOpen }: { bucket: SpotBucket; label: string; items: SpotSuggestion[]; onAdd: (s: SpotSuggestion) => void; onOpen: (s: SpotSuggestion) => void }) {
  if (!items.length) return null;
  return (
    <div data-bucket={bucket}>
      <h4 className="px-1 pb-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">{label}</h4>
      <ul className="space-y-1">
        {items.map((s) => (
          <li key={s.key} className="flex items-center gap-2 rounded-xl bg-neutral-900/80 p-1.5">
            <button type="button" onClick={() => onOpen(s)} className="flex min-w-0 flex-1 items-center gap-2 text-start">
              {s.thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={s.thumb} alt="" loading="lazy" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
              ) : (
                <span className="h-10 w-10 shrink-0 rounded-lg bg-neutral-800" />
              )}
              <span className="min-w-0">
                <span className="block truncate text-xs font-semibold" dir="auto">{s.name}</span>
                <span className="block text-[10px] text-neutral-500">{s.photoCount} photo{s.photoCount === 1 ? "" : "s"} · {s.km < 1 ? "<1" : Math.round(s.km)} km off route</span>
              </span>
            </button>
            <button type="button" onClick={() => onAdd(s)} className="shrink-0 rounded-lg bg-amber-300 px-2 py-1 text-[11px] font-semibold text-neutral-900 hover:bg-amber-200">+ Add to Day</button>
          </li>
        ))}
      </ul>
    </div>
  );
}
