"use client";

import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-map-gl";
import type { User } from "@supabase/supabase-js";
import LocationAutocomplete from "@/components/LocationAutocomplete";
import { MAP_ID } from "@/components/map/constants";
import { useTripStore } from "@/store/tripStore";
import { getAllPins, boundsOf, type Pin } from "@/lib/pins";
import { BUCKETS, DAY_COLORS, MAX_TRIP_DAYS, dbSuggestions, formatDay, scheduleText, solarFor, uid, whatsappItinerary, whatsappUrl, type SpotBucket, type SpotSuggestion, type Stop, type TripDay } from "@/lib/trip";
import { suggestPhotoSpots, type ScoutSpotDto } from "@/lib/aiClient";
import { deleteTrip, listTrips, loadTrip, saveTrip, type SavedTrip } from "@/lib/tripApi";
import { googleMapsRouteUrl } from "@/hooks/useCollectionPhotos";
import type { PlaceSuggestion } from "@/lib/geocode";

const inputCls = "rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-1.5 text-sm text-white outline-none placeholder:text-neutral-500 focus:border-amber-300";
const smallBtn = "rounded-lg bg-white/10 px-2.5 py-1 max-md:min-h-10 text-xs font-medium text-neutral-100 hover:bg-white/20 disabled:opacity-40";

const SCOUT_LABEL: Record<ScoutSpotDto["phase"], string> = { sunrise: "🌅 Sunrise", sunset: "🌇 Sunset / Golden Hour", midday: "☀️ Midday" };

/** "Plan a Photo Trip": dates → day cards → multi-stop days with exact solar times and photo-spot recommendations */
export default function TripPlanner({ user, onRequireLogin }: { user: User | null; onRequireLogin: () => void }) {
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

  const [pins, setPins] = useState<Pin[]>([]);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [saved, setSaved] = useState<SavedTrip[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [spotsOpen, setSpotsOpen] = useState<Record<number, boolean>>({});
  const [ai, setAi] = useState<Record<string, { loading: boolean; spots?: ScoutSpotDto[]; error?: string }>>({});

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
    else map.fitBounds(box, { padding: { top: 120, bottom: 80, left: 80, right: 440 }, maxZoom: 13, duration: 1200 });
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
      className="pointer-events-auto absolute inset-x-2 top-[4.5rem] z-30 flex max-h-[70dvh] flex-col overflow-hidden rounded-2xl border border-white/10 bg-neutral-950/95 text-neutral-100 shadow-2xl backdrop-blur md:inset-x-auto md:bottom-4 md:right-4 md:top-24 md:max-h-none md:w-[400px]"
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
        {trip.days.length >= MAX_TRIP_DAYS && <p className="text-[11px] text-amber-200/80">Trips are limited to {MAX_TRIP_DAYS} days.</p>}

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
          <button type="button" className={smallBtn} onClick={() => { if (!allStops.length || window.confirm("Start a new trip? Unsaved changes are lost.")) { reset(); setSpotsOpen({}); setAi({}); } }}>＋ New</button>
          {allStops.length > 0 && <button type="button" className={smallBtn} onClick={() => fitStops(allStops)}>⤢ Fit</button>}
        </div>
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
          const dbTotal = suggestions ? BUCKETS.reduce((n, b) => n + suggestions[b.key].length, 0) : 0;
          return (
            <section key={day.date + di} className="rounded-2xl border border-white/10 bg-white/[0.03] p-3">
              <header className="mb-2 flex items-center gap-2">
                <span className="h-3 w-3 shrink-0 rounded-full" style={{ background: color }} />
                <h3 className="text-sm font-semibold">Day {di + 1} <span className="font-normal text-neutral-400">- {formatDay(day.date)}</span></h3>
                {mapsUrl && day.stops.length > 1 && (
                  <a href={mapsUrl} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] text-amber-200 hover:underline">Google Maps ↗</a>
                )}
              </header>

              <ol className="space-y-2">
                {day.stops.map((s, si) => {
                  const sol = solarFor(day.date, s.latitude, s.longitude);
                  return (
                    <li key={s.id} className="rounded-xl bg-neutral-900/80 p-2">
                      <div className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-neutral-950" style={{ background: color }}>{si + 1}</span>
                        {s.thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={s.thumb} alt="" className="h-8 w-8 shrink-0 rounded-md object-cover" />
                        )}
                        <button type="button" onClick={() => map?.flyTo({ center: [s.longitude, s.latitude], zoom: Math.max(map.getZoom(), 12), duration: 1000, essential: true })} className="min-w-0 flex-1 text-start">
                          <span className="block truncate text-xs font-semibold" dir="auto">{s.name}</span>
                          <span className="block truncate font-mono text-[10px] text-neutral-500">{s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}{s.source === "ai" ? " · AI" : ""}</span>
                        </button>
                        <span className="flex shrink-0 items-center">
                          <button type="button" onClick={() => moveStop(di, si, si - 1)} disabled={si === 0} aria-label="Move up" className="h-6 w-6 rounded text-neutral-400 hover:bg-white/10 disabled:opacity-25">↑</button>
                          <button type="button" onClick={() => moveStop(di, si, si + 1)} disabled={si === day.stops.length - 1} aria-label="Move down" className="h-6 w-6 rounded text-neutral-400 hover:bg-white/10 disabled:opacity-25">↓</button>
                          <button type="button" onClick={() => removeStop(di, s.id)} aria-label={`Remove ${s.name}`} className="h-6 w-6 rounded text-neutral-400 hover:bg-white/10 hover:text-red-300">×</button>
                        </span>
                      </div>
                      {s.note && <p className="mt-1 line-clamp-2 text-[10px] text-neutral-400">{s.note}</p>}
                      {sol.polar ? (
                        <p className="mt-1.5 text-[10px] text-sky-200">Polar day / night: no regular sunrise or sunset</p>
                      ) : (
                        <dl className="mt-1.5 grid grid-cols-3 gap-1 text-center text-[10px]">
                          <div className="rounded-md bg-amber-300/10 px-1 py-1"><dt className="text-neutral-400">🌅 Sunrise</dt><dd className="font-semibold tabular-nums text-amber-100">{sol.sunrise ?? "-"}</dd></div>
                          <div className="rounded-md bg-orange-300/10 px-1 py-1"><dt className="text-neutral-400">✨ Golden hour</dt><dd className="font-semibold tabular-nums text-orange-100">{sol.goldenEvening ? sol.goldenEvening[0] : "-"}</dd></div>
                          <div className="rounded-md bg-rose-300/10 px-1 py-1"><dt className="text-neutral-400">🌇 Sunset</dt><dd className="font-semibold tabular-nums text-rose-100">{sol.sunset ?? "-"}</dd></div>
                          <div className="col-span-3 text-[10px] text-neutral-500">
                            Morning golden {sol.goldenMorning?.join("-") ?? "-"} · evening golden {sol.goldenEvening?.join("-") ?? "-"} · blue hour {sol.blueDawn ?? "-"} / {sol.blueDusk ?? "-"}{sol.tz ? ` (${sol.tz})` : ""}
                          </div>
                        </dl>
                      )}
                    </li>
                  );
                })}
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
