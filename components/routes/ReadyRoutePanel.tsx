"use client";

import { useEffect, useMemo, useState } from "react";
import { useMap } from "react-map-gl";
import { MAP_ID } from "@/components/map/constants";
import { useRoutesStore } from "@/store/routesStore";
import { deleteReadyRoute } from "@/lib/readyRoutesApi";
import { useMapStore } from "@/store/mapStore";
import { useIsDesktop } from "@/hooks/useIsDesktop";
import { boundsOf } from "@/lib/pins";
import { DAY_COLORS } from "@/lib/trip";
import { googleMapsRouteUrl, GOOGLE_MAPS_MAX_STOPS } from "@/hooks/useCollectionPhotos";
import {
  FREE_TIPS,
  LIGHT_ICON,
  TIP_ICON,
  allStops,
  fmtKm,
  fmtMinutes,
  legBetween,
  routeDistanceKm,
  routeShareUrl,
  routeToGpx,
  routeToKml,
  type CuratedRoute,
} from "@/lib/readyRoutes";

const UTM_SOURCES = [
  { key: "", label: "No UTM" },
  { key: "instagram", label: "Instagram" },
  { key: "facebook", label: "Facebook" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "tiktok", label: "TikTok" },
  { key: "newsletter", label: "Newsletter" },
];

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function downloadText(text: string, name: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Printable itinerary in a new tab → the browser's "Save as PDF" */
function printPdf(r: CuratedRoute) {
  const w = window.open("", "_blank");
  if (!w) return false;
  const days = r.plan.days
    .map(
      (d, i) => `<h2>Day ${i + 1}${d.title ? ` · ${esc(d.title)}` : ""}</h2><ol>${d.stops
        .map((s, j) => {
          const leg = j ? legBetween(d.stops[j - 1], s) : null;
          return `<li>${leg ? `<p class="leg">${leg.mode === "walk" ? "🚶" : "🚗"} ${fmtKm(leg.km)} · ≈ ${fmtMinutes(leg.minutes)}</p>` : ""}<div class="stop">${s.thumb ? `<img src="${esc(s.thumb)}" alt="">` : ""}<div><strong>${esc(s.name)}</strong>${s.light ? ` <span class="chip">${LIGHT_ICON[s.light]} ${s.light}</span>` : ""}<br><small>${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}</small>${s.description ? `<p>${esc(s.description)}</p>` : ""}${s.logistics ? `<p>🅿️ ${esc(s.logistics)}</p>` : ""}</div></div></li>`;
        })
        .join("")}</ol>`,
    )
    .join("");
  const tips = r.tips.length ? `<h2>Pro tips</h2><ul>${r.tips.map((t) => `<li>${TIP_ICON[t.kind] ?? "📷"} ${t.stop ? `<strong>${esc(t.stop)}:</strong> ` : ""}${esc(t.text)}</li>`).join("")}</ul>` : "";
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(r.title)} · StoryMap</title><style>
    body{font:14px/1.45 -apple-system,Segoe UI,Arial,sans-serif;color:#111;max-width:780px;margin:24px auto;padding:0 16px}
    h1{margin:0 0 4px}h2{margin:22px 0 8px;border-bottom:2px solid #fbbf24;padding-bottom:3px}
    ol{padding-left:20px}li{margin:8px 0;break-inside:avoid}.stop{display:flex;gap:10px}.stop img{width:90px;height:64px;object-fit:cover;border-radius:6px}
    .chip{background:#fef3c7;border-radius:99px;padding:1px 7px;font-size:12px}.leg{color:#666;font-size:12px;margin:0 0 4px}p{margin:4px 0}small{color:#666}
  </style></head><body><h1>${esc(r.title)}</h1><p>${esc([r.country, `${r.days} days`, `${r.stops_count} stops`].filter(Boolean).join(" · "))}</p>${r.description ? `<p>${esc(r.description)}</p>` : ""}<p><small>${esc(routeShareUrl(r.slug))}</small></p>${days}${tips}<script>window.onload=()=>setTimeout(()=>window.print(),400)</script></body></html>`);
  w.document.close();
  return true;
}

/** The open Ready Route: day-by-day itinerary, distances, light per stop, tips (freemium) and share / export actions */
export default function ReadyRoutePanel() {
  const { [MAP_ID]: map } = useMap();
  const route = useRoutesStore((s) => s.active);
  const closeRoute = useRoutesStore((s) => s.closeRoute);
  const setGalleryOpen = useRoutesStore((s) => s.setGalleryOpen);
  const isAdmin = useRoutesStore((s) => s.isAdmin);
  const openEditor = useRoutesStore((s) => s.openEditor);
  const bump = useRoutesStore((s) => s.bump);
  const signedIn = Boolean(useMapStore((s) => s.currentUserId));
  const requestLogin = useMapStore((s) => s.requestLogin);
  const isDesktop = useIsDesktop();
  const [utm, setUtm] = useState("instagram");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const stops = useMemo(() => (route ? allStops(route) : []), [route]);

  // Fit the whole route once per opened route
  useEffect(() => {
    if (!route || !map || !stops.length) return;
    setCollapsed(false);
    const box = boundsOf(stops);
    if (!box) return;
    if (stops.length === 1) map.flyTo({ center: box[0], zoom: 12, duration: 1600, essential: true });
    else map.fitBounds(box, { padding: isDesktop ? { top: 120, bottom: 60, left: 80, right: 480 } : { top: 90, bottom: 360, left: 40, right: 40 }, maxZoom: 13, duration: 1600 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [route?.id, map]);

  if (!route) return null;

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(null), 4000);
  };
  const copyLink = async () => {
    const url = routeShareUrl(route.slug, utm ? { source: utm, medium: utm === "newsletter" ? "email" : "social" } : undefined, window.location.origin);
    try {
      await navigator.clipboard.writeText(url);
      flash("Share link copied");
    } catch {
      window.prompt("Copy this link", url);
    }
  };
  const gated = (fn: () => void | Promise<void>) => async () => {
    if (!signedIn) return requestLogin();
    await fn();
  };
  const fileBase = route.slug || "storymap-route";
  const exportXlsx = gated(async () => {
    setBusy(true);
    try {
      const [{ exportTripXlsx }, { routeToTrip }] = await Promise.all([import("@/lib/tripExcel"), import("@/lib/readyRoutesTrip")]);
      await exportTripXlsx(routeToTrip(route));
      flash("Excel file downloaded");
    } catch (e) {
      flash(e instanceof Error ? e.message : "Excel export failed");
    } finally {
      setBusy(false);
    }
  });
  const removeRoute = async () => {
    if (!window.confirm(`Delete "${route.title}" from Ready Routes?\n\nIts link (?route=${route.slug}) stops working. This can't be undone.`)) return;
    try {
      await deleteReadyRoute(route.id);
      closeRoute();
      bump();
    } catch (e) {
      flash(e instanceof Error ? e.message : "Could not delete the route");
    }
  };
  const gmaps = googleMapsRouteUrl(stops);
  const km = routeDistanceKm(route);
  const freeTips = route.tips.slice(0, FREE_TIPS);
  const lockedTips = route.tips.slice(FREE_TIPS);
  const btn = "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition max-md:min-h-10";

  return (
    <aside
      aria-label={`Ready Route: ${route.title}`}
      className={`pointer-events-auto absolute z-30 flex flex-col overflow-hidden border border-white/10 bg-neutral-950/95 text-neutral-100 shadow-2xl backdrop-blur
        inset-x-0 bottom-0 rounded-t-3xl pb-[env(safe-area-inset-bottom)] ${collapsed ? "h-16" : "h-[58dvh]"}
        md:inset-x-auto md:bottom-4 md:right-4 md:top-24 md:h-auto md:w-[420px] md:rounded-3xl`}
    >
      <div className="relative shrink-0">
        {route.cover_url && !collapsed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={route.cover_url} alt="" className="h-28 w-full object-cover md:h-36" />
        )}
        <div className={`${route.cover_url && !collapsed ? "absolute inset-0 bg-gradient-to-t from-neutral-950 via-neutral-950/40 to-transparent" : ""}`} />
        <div className={`${route.cover_url && !collapsed ? "absolute inset-x-0 bottom-0" : ""} flex items-end gap-2 px-4 py-3`}>
          <button type="button" onClick={() => setCollapsed((c) => !c)} className="min-w-0 flex-1 text-start" aria-expanded={!collapsed}>
            {route.country && <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">🗺️ Ready Route · {route.country}</p>}
            <h2 className="truncate text-base font-semibold text-white">{route.title}</h2>
            <p className="text-[11px] text-neutral-300">{route.days} day{route.days === 1 ? "" : "s"} · {route.stops_count} stops{km > 0 ? ` · ≈ ${fmtKm(km)}` : ""}</p>
          </button>
          {isAdmin && (
            <>
              <button type="button" onClick={() => openEditor(structuredClone(route))} className="rounded-full bg-sky-400/80 px-2.5 py-1 text-[11px] font-semibold text-neutral-950 hover:bg-sky-300">Edit</button>
              <button type="button" onClick={() => void removeRoute()} className="rounded-full bg-red-600/70 px-2.5 py-1 text-[11px] font-semibold text-white hover:bg-red-600">Delete</button>
            </>
          )}
          <button type="button" onClick={() => { closeRoute(); setGalleryOpen(true); }} className="rounded-full bg-black/50 px-2.5 py-1 text-[11px] font-semibold text-neutral-100 hover:bg-black/70">All routes</button>
          <button type="button" onClick={closeRoute} aria-label="Close route" className="flex h-7 w-7 items-center justify-center rounded-full bg-black/50 text-lg leading-none text-neutral-200 hover:bg-black/70">×</button>
        </div>
      </div>

      {!collapsed && (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-4">
          {route.description && <p className="text-xs leading-relaxed text-neutral-300">{route.description}</p>}

          {/* One-click actions, for everyone */}
          <div className="flex flex-wrap items-center gap-1.5">
            {gmaps && (
              <a href={gmaps} target="_blank" rel="noopener noreferrer" title={stops.length > GOOGLE_MAPS_MAX_STOPS ? `Google Maps takes the first ${GOOGLE_MAPS_MAX_STOPS} stops; each day has its own link below` : undefined} className={`${btn} bg-amber-300 text-neutral-900 hover:bg-amber-200`}>
                Open in Google Maps
              </a>
            )}
            <button type="button" onClick={copyLink} className={`${btn} bg-white/10 hover:bg-white/20`}>🔗 Copy Share Link</button>
            <select value={utm} onChange={(e) => setUtm(e.target.value)} aria-label="UTM source for the share link" className="rounded-lg border border-white/10 bg-neutral-900 px-1.5 py-1 text-[11px] text-neutral-200">
              {UTM_SOURCES.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
            </select>
          </div>

          {/* Exports: free sign-in */}
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={gated(() => downloadText(routeToGpx(route), `${fileBase}.gpx`, "application/gpx+xml"))} className={`${btn} bg-white/10 hover:bg-white/20`}>{signedIn ? "" : "🔒 "}GPX</button>
            <button type="button" onClick={gated(() => downloadText(routeToKml(route), `${fileBase}.kml`, "application/vnd.google-earth.kml+xml"))} className={`${btn} bg-white/10 hover:bg-white/20`}>{signedIn ? "" : "🔒 "}KML</button>
            <button type="button" onClick={exportXlsx} disabled={busy} className={`${btn} bg-emerald-400/20 text-emerald-100 hover:bg-emerald-400/30 disabled:opacity-50`}>{signedIn ? "" : "🔒 "}{busy ? "Building…" : "Excel"}</button>
            <button type="button" onClick={gated(() => { if (!printPdf(route)) flash("Allow pop-ups to print the PDF"); })} className={`${btn} bg-white/10 hover:bg-white/20`}>{signedIn ? "" : "🔒 "}PDF</button>
          </div>
          {msg && <p role="status" className="rounded-lg bg-emerald-950/70 px-3 py-1.5 text-[11px] text-emerald-200">{msg}</p>}

          {/* Tips */}
          {route.tips.length > 0 && (
            <section className="rounded-2xl bg-white/[0.04] p-3">
              <h3 className="mb-1.5 text-xs font-semibold text-amber-100">Pro photo tips</h3>
              <ul className="space-y-1.5 text-xs text-neutral-200">
                {(signedIn ? route.tips : freeTips).map((t, i) => (
                  <li key={i} className="flex gap-1.5">
                    <span aria-hidden>{TIP_ICON[t.kind] ?? "📷"}</span>
                    <span>{t.stop && <strong className="text-white">{t.stop}: </strong>}{t.text}</span>
                  </li>
                ))}
              </ul>
              {!signedIn && lockedTips.length > 0 && (
                <div className="relative mt-2">
                  <ul aria-hidden className="pointer-events-none select-none space-y-1.5 text-xs text-neutral-200 blur-[5px]">
                    {lockedTips.slice(0, 3).map((t, i) => <li key={i}>{TIP_ICON[t.kind] ?? "📷"} {t.text}</li>)}
                  </ul>
                  <button type="button" onClick={requestLogin} className="absolute inset-0 flex items-center justify-center rounded-xl bg-neutral-950/40 px-3 text-center text-xs font-semibold text-amber-200 hover:text-amber-100">
                    🔓 Sign in free to unlock all pro photo tips &amp; GPX/Excel export ({lockedTips.length} more)
                  </button>
                </div>
              )}
            </section>
          )}

          {/* Itinerary */}
          {route.plan.days.map((d, di) => {
            const color = DAY_COLORS[di % DAY_COLORS.length];
            const dayMaps = googleMapsRouteUrl(d.stops);
            return (
              <section key={di}>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full" style={{ background: color }} />
                  <h3 className="text-xs font-semibold">Day {di + 1}{d.title ? ` · ${d.title}` : ""}</h3>
                  <span className="text-[11px] text-neutral-500">{d.stops.length} stops</span>
                  {dayMaps && d.stops.length > 1 && <a href={dayMaps} target="_blank" rel="noopener noreferrer" className="ml-auto text-[11px] text-amber-300 hover:underline">Day in Google Maps ↗</a>}
                </div>
                <ol className="space-y-1">
                  {d.stops.map((s, si) => {
                    const leg = si ? legBetween(d.stops[si - 1], s) : null;
                    return (
                      <li key={si}>
                        {leg && (
                          <p className="py-0.5 pl-9 text-[10px] text-neutral-500">
                            {leg.mode === "walk" ? "🚶 walk" : "🚗 drive"} {fmtKm(leg.km)} · ≈ {fmtMinutes(leg.minutes)}
                          </p>
                        )}
                        <button
                          type="button"
                          onClick={() => map?.flyTo({ center: [s.longitude, s.latitude], zoom: Math.max(map.getZoom(), 13), duration: 1200, essential: true })}
                          className="flex w-full items-start gap-2 rounded-xl bg-white/[0.04] p-2 text-start hover:bg-white/[0.08]"
                        >
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-extrabold text-neutral-950" style={{ background: color }}>{si + 1}</span>
                          {s.thumb && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={s.thumb} alt="" loading="lazy" className="h-12 w-12 shrink-0 rounded-lg object-cover" />
                          )}
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="text-xs font-semibold" dir="auto">{s.name}</span>
                              {s.light && <span className="rounded-full bg-amber-300/15 px-1.5 text-[10px] text-amber-200">{LIGHT_ICON[s.light]} {s.light}</span>}
                            </span>
                            {s.description && <span className="mt-0.5 line-clamp-3 block text-[11px] text-neutral-400">{s.description}</span>}
                            {signedIn && s.logistics && <span className="mt-0.5 block text-[11px] text-sky-200">🅿️ {s.logistics}</span>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      )}
    </aside>
  );
}
