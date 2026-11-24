"use client";

import { useMemo, useRef, useState } from "react";
import { distKm, type Pin } from "@/lib/pins";
import { MAX_REF_PHOTOS, fmtDuration, parseDuration, solarFor, type Stop, type TimedStop } from "@/lib/trip";
import { blobToRefPhoto, imageFromPaste, readClipboardImage, urlToRefPhoto } from "@/lib/refPhotos";

const field = "w-full rounded-md border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-white outline-none placeholder:text-neutral-600 focus:border-amber-300";
const tiny = "rounded-md bg-white/10 px-2 py-1 text-[11px] font-medium text-neutral-100 hover:bg-white/20 disabled:opacity-40";

interface Props {
  stop: Stop;
  index: number;
  count: number;
  color: string;
  timed: TimedStop;
  pins: Pin[];
  onPatch: (patch: Partial<Stop>) => void;
  onMove: (to: number) => void;
  onRemove: () => void;
  onLocate: () => void;
  onNotice: (kind: "ok" | "err", text: string) => void;
  date: string;
}

/** One stop of a day: arrival time, editable duration / description / transit / logistics, and its reference photo strip */
export default function StopCard({ stop: s, index, count, color, timed, pins, onPatch, onMove, onRemove, onLocate, onNotice, date }: Props) {
  const refs = s.refPhotos ?? [];
  const full = refs.length >= MAX_REF_PHOTOS;
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const sol = useMemo(() => solarFor(date, s.latitude, s.longitude), [date, s.latitude, s.longitude]);

  const attach = async (make: () => Promise<string>) => {
    if (full) return onNotice("err", `A stop holds up to ${MAX_REF_PHOTOS} reference photos`);
    setBusy(true);
    try {
      const src = await make();
      onPatch({ refPhotos: [...(s.refPhotos ?? []), src].slice(0, MAX_REF_PHOTOS) });
    } catch {
      onNotice("err", "Could not read that image");
    } finally {
      setBusy(false);
    }
  };

  const pasteButton = async () => {
    try {
      const blob = await readClipboardImage();
      if (!blob) return onNotice("err", "No image on the clipboard. Copy one, then click here (or press Ctrl+V on this stop)");
      await attach(() => blobToRefPhoto(blob));
    } catch {
      onNotice("err", "The browser blocked clipboard access. Click the stop and press Ctrl+V instead");
    }
  };

  const nearby = useMemo(() => {
    if (!picker) return [];
    return pins
      .map((p) => ({ p, km: distKm(p.latitude, p.longitude, s.latitude, s.longitude) }))
      .filter((x) => x.km <= 5)
      .sort((a, b) => a.km - b.km)
      .slice(0, 16);
  }, [picker, pins, s.latitude, s.longitude]);

  return (
    <li
      tabIndex={0}
      onPaste={(e) => {
        const f = imageFromPaste(e);
        if (!f) return;
        e.preventDefault();
        void attach(() => blobToRefPhoto(f));
      }}
      className="rounded-xl bg-neutral-900/80 p-2.5 outline-none ring-amber-300/60 focus-within:ring-1"
    >
      <div className="flex items-center gap-2">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-extrabold text-neutral-950" style={{ background: color }}>{index + 1}</span>
        <span className="shrink-0 rounded-md bg-amber-300/15 px-1.5 py-0.5 font-mono text-sm font-bold tabular-nums text-amber-200" title="Calculated arrival time">{timed.arrive}</span>
        <button type="button" onClick={onLocate} className="min-w-0 flex-1 text-start">
          <span className="block truncate text-sm font-semibold" dir="auto">{s.name}</span>
          <span className="block truncate font-mono text-[10px] text-neutral-500">{s.latitude.toFixed(5)}, {s.longitude.toFixed(5)}{s.source === "ai" ? " · AI" : ""}</span>
        </button>
        <span className="flex shrink-0 items-center">
          <button type="button" onClick={() => onMove(index - 1)} disabled={index === 0} aria-label="Move up" className="h-7 w-7 rounded text-neutral-400 hover:bg-white/10 disabled:opacity-25">↑</button>
          <button type="button" onClick={() => onMove(index + 1)} disabled={index === count - 1} aria-label="Move down" className="h-7 w-7 rounded text-neutral-400 hover:bg-white/10 disabled:opacity-25">↓</button>
          <button type="button" onClick={onRemove} aria-label={`Remove ${s.name}`} className="h-7 w-7 rounded text-neutral-400 hover:bg-white/10 hover:text-red-300">×</button>
        </span>
      </div>

      <div className="mt-2 grid grid-cols-[auto_1fr] gap-x-2 gap-y-1.5 md:grid-cols-[auto_8rem_1fr]">
        <label className="text-[10px] text-neutral-400">
          Duration
          <input
            key={timed.duration}
            defaultValue={fmtDuration(timed.duration)}
            aria-label={`Duration of ${s.name}`}
            inputMode="numeric"
            onBlur={(e) => {
              const m = parseDuration(e.target.value);
              if (m === null) e.target.value = fmtDuration(timed.duration);
              else if (m !== timed.duration) onPatch({ durationMinutes: Math.min(m, 24 * 60) });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            className={`${field} mt-0.5 w-20 text-center font-mono`}
          />
        </label>
        {index > 0 ? (
          <label className="text-[10px] text-neutral-400">
            Transit (min)
            <input
              type="number"
              min={0}
              max={720}
              value={s.transitMinutes ?? 0}
              onChange={(e) => onPatch({ transitMinutes: Math.max(0, Math.min(720, Math.round(Number(e.target.value) || 0))) })}
              aria-label={`Transit minutes to ${s.name}`}
              className={`${field} mt-0.5 text-center font-mono`}
            />
          </label>
        ) : (
          <span className="hidden md:block" />
        )}
        <label className="col-span-2 text-[10px] text-neutral-400 md:col-span-1">
          {index > 0 ? "Transit note" : "Starting point"}
          <input
            value={s.transitNote ?? ""}
            onChange={(e) => onPatch({ transitNote: e.target.value })}
            placeholder={index > 0 ? "e.g. 12 min drive via Rustaveli Ave" : "e.g. Meet at the hotel lobby"}
            maxLength={160}
            className={`${field} mt-0.5`}
          />
        </label>
        <label className="col-span-2 text-[10px] text-neutral-400 md:col-span-3">
          Short description
          <textarea
            value={s.description ?? s.note ?? ""}
            onChange={(e) => onPatch({ description: e.target.value, note: null })}
            rows={2}
            maxLength={400}
            placeholder="What to shoot here and which light suits it"
            className={`${field} mt-0.5 resize-y`}
          />
        </label>
        <label className="col-span-2 text-[10px] text-neutral-400 md:col-span-3">
          Logistics / ticket note
          <input value={s.logistics ?? ""} onChange={(e) => onPatch({ logistics: e.target.value })} maxLength={240} placeholder="Entry fee, parking, permit, opening hours…" className={`${field} mt-0.5`} />
        </label>
      </div>

      {!sol.polar && (
        <p className="mt-1.5 text-[10px] text-neutral-500">
          🌅 {sol.sunrise ?? "-"} · golden {sol.goldenMorning?.join("-") ?? "-"} / {sol.goldenEvening?.join("-") ?? "-"} · 🌇 {sol.sunset ?? "-"} · blue {sol.blueDawn ?? "-"} / {sol.blueDusk ?? "-"}{sol.tz ? ` (${sol.tz})` : ""}
        </p>
      )}

      {/* Shot list: reference / inspiration photos */}
      <div className="mt-2 rounded-lg bg-black/25 p-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Shot list · {refs.length}/{MAX_REF_PHOTOS}</span>
          <span className="ms-auto flex flex-wrap gap-1">
            <button type="button" className={tiny} onClick={pasteButton} disabled={busy || full} title="Paste an image from the clipboard (or press Ctrl+V while this stop is focused)">📋 Paste Image</button>
            <button type="button" className={tiny} onClick={() => setPicker((o) => !o)} disabled={full} aria-expanded={picker}>🗺️ From StoryMap</button>
            <button type="button" className={tiny} onClick={() => fileRef.current?.click()} disabled={busy || full}>⬆ Upload</button>
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            hidden
            onChange={async (e) => {
              const files = Array.from(e.target.files ?? []).slice(0, MAX_REF_PHOTOS - refs.length);
              e.target.value = "";
              if (!files.length) return;
              setBusy(true);
              try {
                const added = await Promise.all(files.map((f) => blobToRefPhoto(f)));
                onPatch({ refPhotos: [...refs, ...added].slice(0, MAX_REF_PHOTOS) });
              } catch {
                onNotice("err", "Could not read that image");
              } finally {
                setBusy(false);
              }
            }}
          />
        </div>
        {refs.length > 0 ? (
          <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {refs.map((src, i) => (
              <li key={i} className="relative shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`Reference ${i + 1} for ${s.name}`} className="h-20 w-auto max-w-[9rem] rounded-md object-cover" />
                <button type="button" aria-label="Remove reference photo" onClick={() => onPatch({ refPhotos: refs.filter((_, j) => j !== i) })} className="absolute right-0.5 top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/70 text-xs text-white hover:bg-red-500">×</button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[10px] text-neutral-600">Click this stop and press Ctrl+V to paste an inspiration photo, or use the buttons.</p>
        )}
        {picker && (
          <div className="mt-2">
            {nearby.length === 0 ? (
              <p className="text-[11px] text-neutral-500">No StoryMap photos within 5 km of this stop.</p>
            ) : (
              <ul className="flex gap-1.5 overflow-x-auto pb-1">
                {nearby.map(({ p, km }) => (
                  <li key={p.id} className="shrink-0">
                    <button
                      type="button"
                      disabled={busy || full}
                      onClick={() => attach(() => urlToRefPhoto(p.thumb_url ?? p.photo_url))}
                      title={`${p.location_name ?? "Photo"} · ${km < 1 ? "<1" : Math.round(km)} km away`}
                      className="block overflow-hidden rounded-md ring-1 ring-white/10 hover:ring-amber-300 disabled:opacity-40"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.thumb_url ?? p.photo_url} alt={p.location_name ?? ""} loading="lazy" className="h-16 w-16 object-cover" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </li>
  );
}
