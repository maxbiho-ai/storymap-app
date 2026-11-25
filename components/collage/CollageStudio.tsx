"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Pin } from "@/lib/pins";
import { getSupabase, PHOTOS_BUCKET } from "@/lib/supabase/client";
import { useMapStore } from "@/store/mapStore";
import { collageContentLabUrl, type ContentLabFolder } from "@/lib/contentLab";
import {
  BACKGROUNDS,
  MAX_COLLAGE_PHOTOS,
  RATIOS,
  STYLES,
  canvasSize,
  drawCollage,
  loadCollageImage,
  pickScenic,
  renderCollageBlob,
  shuffled,
  type CollageBg,
  type CollageItem,
  type CollageOptions,
} from "@/lib/collage";

type Loaded = { img: HTMLImageElement; w: number; h: number } | "error";
type Credit = "storymap" | "photographer" | "off";
interface Meta {
  user_id: string;
  photographer_name: string | null;
}

const PREVIEW_LONG_EDGE = 1000;
const chip = "rounded-lg px-2.5 py-1.5 text-xs font-semibold transition";
const on = "bg-amber-300 text-neutral-900";
const off = "bg-white/10 text-neutral-200 hover:bg-white/20";

/** ✨ Collage Studio: a shareable collage of the current filtered photos, rendered on a canvas and exported at 2400px */
export default function CollageStudio({ pins, defaultTitle, onClose }: { pins: Pin[]; defaultTitle: string; onClose: () => void }) {
  const currentUserId = useMapStore((s) => s.currentUserId);
  const [selected, setSelected] = useState<Pin[]>(() => pickScenic(pins, Math.min(9, MAX_COLLAGE_PHOTOS)));
  const [opts, setOpts] = useState<CollageOptions>(() => ({
    style: "masonry",
    ratio: "10:16",
    bg: "slate",
    border: 2,
    gap: 12,
    title: defaultTitle.toUpperCase(),
    showTitle: Boolean(defaultTitle),
    watermark: "StoryMap",
    captions: true,
    seed: 1,
  }));
  const [credit, setCredit] = useState<Credit>("storymap");
  const [images, setImages] = useState<Record<string, Loaded>>({});
  const [meta, setMeta] = useState<Record<string, Meta>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [idea, setIdea] = useState<string | null>(null);
  const [poolAll, setPoolAll] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Full-size images for the selected photos (CORS-safe, so the canvas stays exportable)
  useEffect(() => {
    let alive = true;
    for (const p of selected) {
      if (images[p.id]) continue;
      loadCollageImage(p.photo_url || p.thumb_url || "")
        .then((img) => alive && setImages((m) => ({ ...m, [p.id]: { img, w: img.naturalWidth, h: img.naturalHeight } })))
        .catch(() => alive && setImages((m) => ({ ...m, [p.id]: "error" })));
    }
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  // Owner + photographer of the selected photos (Content Lab PAST / EVERGREEN and the credit line)
  const selectedKey = selected.map((p) => p.id).join(",");
  useEffect(() => {
    const missing = selected.map((p) => p.id).filter((id) => !meta[id]);
    if (!missing.length) return;
    let alive = true;
    getSupabase()
      .from("photos")
      .select("id, user_id, photographer_name")
      .in("id", missing)
      .then(({ data }) => {
        if (!alive || !data) return;
        setMeta((m) => {
          const n = { ...m };
          for (const r of data as (Meta & { id: string })[]) n[r.id] = { user_id: r.user_id, photographer_name: r.photographer_name };
          return n;
        });
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const photographers = useMemo(() => [...new Set(selected.map((p) => meta[p.id]?.photographer_name?.trim()).filter(Boolean) as string[])], [selected, meta]);
  const watermark = credit === "off" ? null : credit === "photographer" && photographers.length ? `© ${photographers.slice(0, 2).join(" & ")}${photographers.length > 2 ? " +" : ""}` : "StoryMap";
  const fullOpts = useMemo(() => ({ ...opts, watermark }), [opts, watermark]);

  const items = useMemo<CollageItem[]>(
    () =>
      selected.flatMap((p) => {
        const im = images[p.id];
        return im && im !== "error" ? [{ img: im.img, w: im.w, h: im.h, caption: p.location_name }] : [];
      }),
    [selected, images],
  );
  const loading = selected.some((p) => !images[p.id]);
  const failed = selected.filter((p) => images[p.id] === "error").length;

  // Live preview: the same drawing code as the export, at a smaller size
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const { W, H } = canvasSize(opts.ratio, PREVIEW_LONG_EDGE);
    c.width = W;
    c.height = H;
    const ctx = c.getContext("2d");
    if (ctx) drawCollage(ctx, W, H, items, fullOpts);
  }, [items, fullOpts, opts.ratio]);

  const set = <K extends keyof CollageOptions>(k: K, v: CollageOptions[K]) => setOpts((o) => ({ ...o, [k]: v }));
  const toggle = (p: Pin) =>
    setSelected((s) => (s.some((x) => x.id === p.id) ? s.filter((x) => x.id !== p.id) : s.length >= MAX_COLLAGE_PHOTOS ? s : [...s, p]));
  const move = (i: number, d: number) =>
    setSelected((s) => {
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const n = [...s];
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });
  const shuffle = () => {
    setSelected((s) => shuffled(s));
    setOpts((o) => ({ ...o, seed: o.seed + 1 }));
  };

  const flash = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg(null), 6000);
  };
  const fileName = `${(opts.title || defaultTitle || "storymap-collage").toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "storymap-collage"}.png`;

  const downloadBlob = (blob: Blob, name: string) => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const downloadPng = async () => {
    if (!items.length) return;
    setBusy("png");
    try {
      downloadBlob(await renderCollageBlob(items, fullOpts, "image/png"), fileName);
      flash(true, "PNG downloaded");
    } catch (e) {
      flash(false, e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const isOwner = Boolean(currentUserId && selected.length && selected.every((p) => meta[p.id]?.user_id === currentUserId));

  const sendToContentLab = async (folder: ContentLabFolder, note?: string) => {
    if (!items.length) return;
    // Opened inside the click so it is not popup-blocked; pointed at Content Lab once the image is uploaded
    const win = window.open("about:blank", "_blank");
    setBusy(folder);
    try {
      const blob = await renderCollageBlob(items, fullOpts, "image/jpeg");
      let imageUrl: string | null = null;
      if (currentUserId) {
        const path = `${currentUserId}/collages/${crypto.randomUUID()}.jpg`;
        const bucket = getSupabase().storage.from(PHOTOS_BUCKET);
        const { error } = await bucket.upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
        if (!error) imageUrl = bucket.getPublicUrl(path).data.publicUrl;
      }
      if (!imageUrl) downloadBlob(await renderCollageBlob(items, fullOpts, "image/png"), fileName);
      const countries = [...new Set(selected.map((p) => p.country).filter(Boolean))];
      const { url, payload } = collageContentLabUrl(
        {
          imageUrl,
          title: opts.title || defaultTitle,
          locations: selected.map((p) => p.location_name?.trim()).filter(Boolean) as string[],
          country: countries.length === 1 ? countries[0] : null,
          tags: selected.flatMap((p) => p.tags ?? []),
          credit: photographers.join(", ") || null,
          photoIds: selected.map((p) => p.id),
          ideaNote: note,
        },
        folder,
      );
      if (win) {
        win.opener = null;
        win.location.href = url;
      } else window.open(url, "_blank", "noopener,noreferrer");
      void navigator.clipboard?.writeText(JSON.stringify(payload, null, 2)).catch(() => undefined);
      const where = folder === "playbook" ? "A Bank of Ideas" : folder.toUpperCase();
      flash(true, imageUrl ? `Sent to Content Lab (${where}).` : `Opened Content Lab (${where}). The PNG was downloaded: attach it there.`);
    } catch (e) {
      win?.close();
      flash(false, e instanceof Error ? e.message : "Could not send the collage");
    } finally {
      setBusy(null);
    }
  };

  const pool = poolAll ? pins : pins.slice(0, 60);
  const ownerOnly = "Only the owner of every photo in the collage can send it to this folder";

  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Collage Studio" className="fixed inset-0 z-[70] flex items-stretch justify-center bg-black/70 p-0 backdrop-blur-sm md:p-6" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="flex w-full max-w-6xl flex-col overflow-hidden bg-neutral-950 text-neutral-100 shadow-2xl md:rounded-3xl md:border md:border-white/10">
        <div className="flex items-center gap-3 border-b border-white/10 px-4 py-3">
          <h2 className="text-sm font-semibold">✨ Collage Studio</h2>
          <span className="text-xs text-neutral-400">{selected.length}/{MAX_COLLAGE_PHOTOS} photos · from {pins.length.toLocaleString()} results</span>
          <button type="button" onClick={onClose} aria-label="Close Collage Studio" className="ml-auto text-2xl leading-none text-neutral-400 hover:text-white">×</button>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[300px_1fr] md:overflow-hidden">
          {/* Controls */}
          <div className="space-y-4 border-white/10 p-4 md:overflow-y-auto md:border-r">
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Style</h3>
              <div className="grid grid-cols-2 gap-1.5">
                {STYLES.map((s) => (
                  <button key={s.key} type="button" onClick={() => set("style", s.key)} aria-pressed={opts.style === s.key} title={s.hint} className={`${chip} text-start ${opts.style === s.key ? on : off}`}>
                    {s.label}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Aspect ratio</h3>
              <div className="flex flex-wrap gap-1.5">
                {RATIOS.map((r) => (
                  <button key={r.key} type="button" onClick={() => set("ratio", r.key)} aria-pressed={opts.ratio === r.key} className={`${chip} ${opts.ratio === r.key ? on : off}`}>
                    {r.label}
                  </button>
                ))}
              </div>
            </section>
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Background</h3>
              <div className="flex gap-2">
                {(Object.keys(BACKGROUNDS) as CollageBg[]).map((k) => (
                  <button key={k} type="button" onClick={() => set("bg", k)} aria-pressed={opts.bg === k} title={BACKGROUNDS[k].label} className={`flex items-center gap-1.5 ${chip} ${opts.bg === k ? on : off}`}>
                    <span className="h-3.5 w-3.5 rounded-full ring-1 ring-black/30" style={{ background: BACKGROUNDS[k].fill }} />
                    {BACKGROUNDS[k].label}
                  </button>
                ))}
              </div>
            </section>
            <section className="grid grid-cols-2 gap-3">
              <label className="text-[11px] text-neutral-400">
                Border {opts.border}
                <input type="range" min={0} max={10} value={opts.border} onChange={(e) => set("border", Number(e.target.value))} className="mt-1 w-full accent-amber-300" />
              </label>
              <label className="text-[11px] text-neutral-400">
                Gap {opts.gap}
                <input type="range" min={0} max={40} value={opts.gap} onChange={(e) => set("gap", Number(e.target.value))} className="mt-1 w-full accent-amber-300" />
              </label>
            </section>
            <section className="space-y-1.5">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={opts.showTitle} onChange={(e) => set("showTitle", e.target.checked)} className="accent-amber-300" />
                Title overlay
              </label>
              <input value={opts.title} onChange={(e) => set("title", e.target.value)} disabled={!opts.showTitle} maxLength={60} placeholder="ICELAND WATERFALLS" aria-label="Collage title" className="w-full rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-1.5 text-sm outline-none focus:border-amber-300 disabled:opacity-40" />
              {opts.style === "postcard" && (
                <label className="flex items-center gap-2 text-xs">
                  <input type="checkbox" checked={opts.captions} onChange={(e) => set("captions", e.target.checked)} className="accent-amber-300" />
                  Location subtitles
                </label>
              )}
            </section>
            <section>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">Credit</h3>
              <div className="flex flex-wrap gap-1.5">
                {(["storymap", "photographer", "off"] as Credit[]).map((c) => (
                  <button key={c} type="button" onClick={() => setCredit(c)} aria-pressed={credit === c} className={`${chip} ${credit === c ? on : off}`}>
                    {c === "storymap" ? "StoryMap" : c === "photographer" ? "Photographer" : "Off"}
                  </button>
                ))}
              </div>
            </section>

            <section className="space-y-2 border-t border-white/10 pt-3">
              <button type="button" onClick={downloadPng} disabled={!items.length || busy !== null} className="w-full rounded-xl bg-amber-300 py-2.5 text-sm font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-50">
                {busy === "png" ? "Rendering…" : "⬇ Download PNG"}
              </button>
              <div className="flex flex-nowrap gap-1.5">
                <button type="button" disabled={!isOwner || busy !== null || !items.length} onClick={() => void sendToContentLab("past")} title={isOwner ? "Send to Content Lab Past folder" : ownerOnly} className="shrink-0 rounded-md bg-violet-400/90 px-2.5 py-1.5 text-xs font-bold text-neutral-950 hover:bg-violet-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-neutral-500">PAST</button>
                <button type="button" disabled={!isOwner || busy !== null || !items.length} onClick={() => void sendToContentLab("evergreen")} title={isOwner ? "Send to Content Lab Evergreen folder" : ownerOnly} className="shrink-0 rounded-md bg-emerald-400/90 px-2.5 py-1.5 text-xs font-bold text-neutral-950 hover:bg-emerald-300 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-neutral-500">EVERGREEN</button>
                <button type="button" disabled={busy !== null || !items.length} onClick={() => setIdea((v) => (v === null ? "" : null))} title="Send to Content Lab Content Playbook" className="shrink-0 whitespace-nowrap rounded-md bg-amber-300 px-2.5 py-1.5 text-xs font-bold text-neutral-950 hover:bg-amber-200 disabled:opacity-50">A Bank of Ideas</button>
              </div>
              {idea !== null && (
                <div className="space-y-1.5">
                  <textarea value={idea} onChange={(e) => setIdea(e.target.value)} rows={3} maxLength={1000} autoFocus aria-label="Your idea for this collage" placeholder="Your idea for this collage (a carousel, a reel cover, a caption hook…)" className="w-full resize-y rounded-lg border border-white/10 bg-neutral-900 px-2.5 py-1.5 text-xs outline-none focus:border-amber-300" />
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={() => setIdea(null)} className="rounded-lg px-2.5 py-1 text-xs text-neutral-300 hover:bg-white/10">Cancel</button>
                    <button type="button" disabled={!idea.trim()} onClick={() => { void sendToContentLab("playbook", idea); setIdea(null); }} className="rounded-lg bg-amber-300 px-3 py-1 text-xs font-semibold text-neutral-900 disabled:opacity-40">Send idea</button>
                  </div>
                </div>
              )}
              {msg && <p role="status" className={`rounded-lg px-3 py-1.5 text-[11px] ${msg.ok ? "bg-emerald-950/70 text-emerald-200" : "bg-red-950/70 text-red-200"}`}>{msg.text}</p>}
            </section>
          </div>

          {/* Preview + photos */}
          <div className="flex min-h-0 flex-col gap-3 p-4 md:overflow-y-auto">
            <div className="relative flex h-[min(58dvh,620px)] shrink-0 items-center justify-center rounded-2xl bg-neutral-900/60 p-3">
              <canvas ref={canvasRef} aria-label="Collage preview" className="h-full w-full object-contain drop-shadow-2xl" />
              {loading && <span className="absolute right-4 top-4 h-4 w-4 animate-spin rounded-full border-2 border-white/20 border-t-white/80" aria-label="Loading photos" />}
              {!selected.length && <p className="absolute text-sm text-neutral-400">Pick photos below to start your collage.</p>}
            </div>
            {failed > 0 && <p className="text-[11px] text-amber-200">{failed} photo{failed === 1 ? "" : "s"} could not be loaded and {failed === 1 ? "is" : "are"} left out.</p>}

            <div>
              <div className="mb-1.5 flex items-center gap-2">
                <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neutral-400">In the collage · order</h3>
                <button type="button" onClick={shuffle} disabled={selected.length < 2} className={`${chip} ${off} ml-auto disabled:opacity-40`}>🔀 Shuffle</button>
                <button type="button" onClick={() => setSelected(pickScenic(pins, 9))} className={`${chip} ${off}`}>✨ Auto-pick</button>
              </div>
              <ol className="flex gap-2 overflow-x-auto pb-1">
                {selected.map((p, i) => (
                  <li key={p.id} className="relative shrink-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.thumb_url ?? p.photo_url} alt={p.location_name ?? ""} className="h-16 w-16 rounded-lg object-cover" />
                    <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-bold">{i + 1}</span>
                    <div className="mt-1 flex justify-between">
                      <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move earlier" className="rounded px-1 text-xs text-neutral-300 hover:bg-white/10 disabled:opacity-30">◀</button>
                      <button type="button" onClick={() => toggle(p)} aria-label="Remove from collage" className="rounded px-1 text-xs text-red-300 hover:bg-white/10">✕</button>
                      <button type="button" onClick={() => move(i, 1)} disabled={i === selected.length - 1} aria-label="Move later" className="rounded px-1 text-xs text-neutral-300 hover:bg-white/10 disabled:opacity-30">▶</button>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div>
              <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-400">All results · tap to add or remove</h3>
              <ul className="grid grid-cols-5 gap-1.5 sm:grid-cols-8 lg:grid-cols-10">
                {pool.map((p) => {
                  const inIt = selected.some((s) => s.id === p.id);
                  return (
                    <li key={p.id}>
                      <button type="button" onClick={() => toggle(p)} aria-pressed={inIt} disabled={!inIt && selected.length >= MAX_COLLAGE_PHOTOS} className={`relative block aspect-square w-full overflow-hidden rounded-lg disabled:opacity-40 ${inIt ? "ring-2 ring-amber-300" : ""}`}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={p.thumb_url ?? p.photo_url} alt={p.location_name ?? ""} loading="lazy" className="h-full w-full object-cover" />
                        {inIt && <span className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-amber-300 text-[10px] font-bold text-neutral-900">✓</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {!poolAll && pins.length > pool.length && (
                <button type="button" onClick={() => setPoolAll(true)} className="mt-2 w-full rounded-lg py-1.5 text-xs text-neutral-400 hover:bg-white/5">Show all {pins.length} photos</button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
