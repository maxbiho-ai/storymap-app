"use client";

import { useMemo, useState } from "react";
import { useMap } from "react-map-gl";
import { useMapStore } from "@/store/mapStore";
import { spotPhotoCount, type CountrySummary, type LightCounts, type Pin, type Place } from "@/lib/pins";
import type { TimeOfDay } from "@/lib/timeOfDay";
import TimeIcon from "@/components/map/TimeIcon";
import { MAP_ID } from "@/components/map/constants";

interface Props {
  /** Photos matching the active filters, newest first (already capped at 500) */
  gridPins: Pin[];
  /** Total matches (can be more than gridPins.length) */
  matchCount: number;
  /** Destinations grouped by country / place: the default view when no filter is active */
  summary: CountrySummary[];
  totalPins: number;
  filtersActive: boolean;
  /** Pins of the spot whose card is open: shown while nothing is filtered */
  openSpot?: Pin[] | null;
  loading?: boolean;
  onClearFilters: () => void;
}

const phaseIcon = (p: Pin["solar_phase"]): TimeOfDay | null => (p === "sunrise" ? "sunrise" : p === "sunset" ? "sunset" : p === "night" ? "night" : p === "blue" ? "sunset" : p === "day" ? "day" : null);

function LightBadges({ light }: { light: LightCounts }) {
  const items = [
    { n: light.golden, icon: "🌅", label: "Golden hour / sunrise / sunset" },
    { n: light.blue, icon: "🔵", label: "Blue hour" },
    { n: light.night, icon: "🌙", label: "Night" },
    { n: light.day, icon: "☀️", label: "Daytime" },
  ].filter((i) => i.n > 0);
  if (!items.length) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-1">
      {items.map((i) => (
        <span key={i.icon} title={i.label} className="inline-flex items-center gap-0.5 rounded-full bg-white/10 px-1.5 text-[10px] leading-4 text-neutral-200">
          <span aria-hidden>{i.icon}</span>
          {i.n}
        </span>
      ))}
    </span>
  );
}

/**
 * Floating sidebar, two modes:
 * - no filter: Destinations (country → place) with cover thumbnails and lighting badges; a click flies there and filters
 * - any filter (search, tag, light, country, spot): the photo grid (up to 500) of what matches
 * Desktop: floating panel on the side; mobile: collapsible bottom sheet.
 */
export default function FloatingGallery({ gridPins, matchCount, summary, totalPins, filtersActive, openSpot, loading, onClearFilters }: Props) {
  const { [MAP_ID]: map } = useMap();
  const hoveredId = useMapStore((s) => s.hoveredId);
  const setHovered = useMapStore((s) => s.setHovered);
  const selectedId = useMapStore((s) => s.selectedId);
  const select = useMapStore((s) => s.select);
  const pickMode = useMapStore((s) => s.pickMode);
  const setCountryFilter = useMapStore((s) => s.setCountryFilter);
  const setSpotFilter = useMapStore((s) => s.setSpotFilter);
  const showTimeline = useMapStore((s) => s.showTimeline);
  const setShowTimeline = useMapStore((s) => s.setShowTimeline);
  const countryFilter = useMapStore((s) => s.countryFilter);
  const spotFilter = useMapStore((s) => s.spotFilter);
  const photographer = useMapStore((s) => s.filters.photographer);
  const area = useMapStore((s) => s.filters.area);
  const [open, setOpen] = useState(true);
  const destinationsOpen = useMapStore((s) => s.destinationsOpen);
  const setDestinationsOpen = useMapStore((s) => s.setDestinationsOpen);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [more, setMore] = useState<Set<string>>(new Set());

  const collapseOnMobile = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) setDestinationsOpen(false);
  };

  const flyToPhoto = (p: Pin) => {
    select(p.id);
    const zoom = Math.max(map?.getZoom() ?? 0, 13);
    map?.flyTo({ center: [p.longitude, p.latitude], zoom, speed: 1.4, curve: 1.5, essential: true });
    collapseOnMobile();
  };

  const openPlace = (pl: Place) => {
    setSpotFilter(pl.name);
    collapseOnMobile();
  };

  const toggle = (name: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(name)) n.delete(name);
      else n.add(name);
      return n;
    });

  const mode: "places" | "photos" | "spot" = filtersActive ? "photos" : openSpot?.length ? "spot" : "places";
  const photos = mode === "spot" ? openSpot! : gridPins;
  const spotCount = useMemo(() => (mode === "spot" ? spotPhotoCount(photos) : photos.length), [mode, photos]);
  const placeCount = useMemo(() => summary.reduce((n, c) => n + c.places.length, 0), [summary]);
  // The timeline only makes sense for one trip / country / area / person at a time
  const canTimeline = Boolean(countryFilter || spotFilter || area || photographer) && matchCount > 1;

  if (pickMode) return null;

  const title =
    mode === "places" ? (
      <>
        Destinations
        <span className="ms-2 font-normal text-neutral-400">{placeCount.toLocaleString()} places · {totalPins.toLocaleString()} photos</span>
      </>
    ) : mode === "spot" ? (
      <>
        This spot
        <span className="ms-2 font-normal text-neutral-400">{spotCount} photo{spotCount === 1 ? "" : "s"}</span>
      </>
    ) : (
      <>
        {spotFilter ?? countryFilter ?? "Matching photos"}
        <span className="ms-2 font-normal text-neutral-400">
          {matchCount.toLocaleString()} photo{matchCount === 1 ? "" : "s"}
        </span>
      </>
    );

  return (
    <aside
      aria-label={mode === "places" ? "Destinations" : "Photos"}
      className={`pointer-events-auto absolute z-10 flex flex-col overflow-hidden border border-white/10 bg-neutral-950/80 text-neutral-100 shadow-2xl backdrop-blur-xl transition-[height] duration-300
        inset-x-0 bottom-0 h-[50dvh] rounded-t-3xl pb-[env(safe-area-inset-bottom)] ${destinationsOpen ? "" : "max-md:hidden"}
        md:inset-x-auto md:bottom-4 md:start-4 md:top-36 md:h-auto md:w-[340px] md:rounded-3xl ${open ? "" : "md:bottom-auto md:h-14"}`}
    >
      <button
        type="button"
        onClick={() => (window.matchMedia("(max-width: 767px)").matches ? setDestinationsOpen(false) : setOpen((o) => !o))}
        className="flex min-h-12 shrink-0 items-center justify-between gap-2 px-5 py-4 text-start"
        aria-expanded={open}
      >
        <span className="absolute inset-x-0 top-1.5 mx-auto h-1 w-10 rounded-full bg-white/20 md:hidden" />
        <span className="min-w-0 truncate text-sm font-semibold">{title}</span>
        <span className="flex items-center gap-2">
          {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-white/20 border-t-white/70" />}
          <svg viewBox="0 0 20 20" className={`h-4 w-4 fill-neutral-400 transition-transform ${open ? "max-md:rotate-0" : "rotate-180"}`} aria-hidden>
            <path d="M5.3 7.3a1 1 0 011.4 0L10 10.6l3.3-3.3a1 1 0 111.4 1.4l-4 4a1 1 0 01-1.4 0l-4-4a1 1 0 010-1.4z" />
          </svg>
        </span>
      </button>

      {open && mode !== "places" && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 px-4 pb-2 text-xs">
          <button
            type="button"
            onClick={mode === "spot" ? () => select(null) : onClearFilters}
            className="rounded-full bg-white/10 px-2.5 py-1 font-medium text-neutral-200 hover:bg-white/20"
          >
            ← {mode === "spot" ? "Close spot" : "All destinations"}
          </button>
          {mode === "photos" && canTimeline && (
            <button
              type="button"
              onClick={() => setShowTimeline(!showTimeline)}
              aria-pressed={showTimeline}
              title="Draw a dashed line through the photos in the order they were taken"
              className={`rounded-full px-2.5 py-1 font-medium transition ${showTimeline ? "bg-sky-300 text-neutral-900" : "bg-white/10 text-neutral-200 hover:bg-white/20"}`}
            >
              ⤳ Trip line
            </button>
          )}
          {mode === "photos" && matchCount > photos.length && <span className="text-neutral-500">showing newest {photos.length}</span>}
        </div>
      )}

      {open && (
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4">
          {mode === "places" ? (
            summary.length === 0 ? (
              <p className="px-2 py-10 text-center text-sm text-neutral-400">{loading ? "Loading…" : "No photos yet."}</p>
            ) : (
              <ul className="space-y-1">
                {summary.map((c, ci) => {
                  const isOpen = expanded.has(c.name) || (expanded.size === 0 && ci === 0);
                  const shown = more.has(c.name) ? c.places : c.places.slice(0, 25);
                  return (
                    <li key={c.name} className="rounded-2xl bg-white/[0.03]">
                      <div className="flex items-center gap-1 px-2 py-2">
                        <button type="button" onClick={() => toggle(c.name)} aria-expanded={isOpen} aria-label={`${isOpen ? "Collapse" : "Expand"} ${c.name}`} className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 hover:bg-white/10 max-md:h-11 max-md:w-11">
                          <svg viewBox="0 0 20 20" className={`h-3.5 w-3.5 fill-current transition-transform ${isOpen ? "rotate-90" : ""}`} aria-hidden>
                            <path d="M7 4l7 6-7 6z" />
                          </svg>
                        </button>
                        <button
                          type="button"
                          disabled={c.name === "Other places"}
                          onClick={() => {
                            setCountryFilter(c.name);
                            collapseOnMobile();
                          }}
                          className="min-w-0 flex-1 text-start disabled:cursor-default max-md:min-h-11"
                          title={c.name === "Other places" ? undefined : `Show only ${c.name}`}
                        >
                          <span className="flex items-center justify-between gap-2">
                            <span className="truncate text-sm font-semibold">{c.name}</span>
                            <span className="shrink-0 rounded-full bg-amber-300/15 px-2 text-[11px] font-semibold tabular-nums text-amber-200">{c.count.toLocaleString()}</span>
                          </span>
                          <LightBadges light={c.light} />
                        </button>
                      </div>
                      {isOpen && (
                        <ul className="space-y-0.5 px-1.5 pb-2">
                          {shown.map((pl) => (
                            <li key={pl.name}>
                              <button
                                type="button"
                                onClick={() => openPlace(pl)}
                                onMouseEnter={() => setHovered(pl.cover.id)}
                                onMouseLeave={() => setHovered(null)}
                                className="flex w-full items-center gap-2.5 rounded-xl px-1.5 py-1.5 text-start hover:bg-white/10"
                              >
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img src={pl.cover.thumb_url ?? pl.cover.photo_url} alt="" loading="lazy" className="h-11 w-11 shrink-0 rounded-lg bg-neutral-800 object-cover" />
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center justify-between gap-2">
                                    <span className="truncate text-xs font-medium" dir="auto">{pl.name}</span>
                                    <span className="shrink-0 text-[11px] tabular-nums text-neutral-400">{pl.count}</span>
                                  </span>
                                  <LightBadges light={pl.light} />
                                </span>
                              </button>
                            </li>
                          ))}
                          {!more.has(c.name) && c.places.length > shown.length && (
                            <li>
                              <button type="button" onClick={() => setMore((s) => new Set(s).add(c.name))} className="w-full rounded-lg py-1.5 text-xs text-neutral-400 hover:bg-white/5 max-md:min-h-11">
                                Show {c.places.length - shown.length} more places
                              </button>
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  );
                })}
              </ul>
            )
          ) : photos.length === 0 ? (
            <p className="px-2 py-10 text-center text-sm text-neutral-400">{loading ? "Loading…" : "No photos match these filters."}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-2 md:grid-cols-2">
              {photos.map((p) => {
                const tod = phaseIcon(p.solar_phase);
                const active = hoveredId === p.id || selectedId === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setHovered(p.id)}
                      onMouseLeave={() => setHovered(null)}
                      onFocus={() => setHovered(p.id)}
                      onBlur={() => setHovered(null)}
                      onClick={() => flyToPhoto(p)}
                      className={`group relative block aspect-square w-full overflow-hidden rounded-xl bg-neutral-800 outline-none transition ${
                        active ? "ring-2 ring-amber-300 ring-offset-2 ring-offset-neutral-950" : "ring-0"
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={p.thumb_url ?? p.photo_url}
                        alt={p.title ?? p.location_name ?? ""}
                        loading="lazy"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent px-2 pb-1.5 pt-6 text-start text-[11px] leading-tight text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus:opacity-100">
                        {p.location_name ?? p.title ?? ""}
                      </span>
                      {tod && <TimeIcon t={tod} size={18} className="absolute end-1.5 top-1.5" />}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </aside>
  );
}
