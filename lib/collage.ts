"use client";

import type { Pin } from "@/lib/pins";

/* ------------------------------------------------------------------ */
/* Options                                                             */
/* ------------------------------------------------------------------ */

export type CollageStyle = "scrapbook" | "masonry" | "hero" | "postcard";
export type CollageRatio = "10:16" | "16:10" | "1:1";
export type CollageBg = "slate" | "white" | "sand";

export const STYLES: { key: CollageStyle; label: string; hint: string }[] = [
  { key: "scrapbook", label: "Dynamic Scrapbook", hint: "Tilted, overlapping cards" },
  { key: "masonry", label: "Editorial Masonry", hint: "Clean grid, true aspect ratios" },
  { key: "hero", label: "Hero + Grid", hint: "One big hero, small supporting frames" },
  { key: "postcard", label: "Postcard Strip", hint: "Magazine strips with captions" },
];

export const RATIOS: { key: CollageRatio; label: string }[] = [
  { key: "10:16", label: "10:16 Vertical" },
  { key: "16:10", label: "16:10 Horizontal" },
  { key: "1:1", label: "1:1 Square" },
];

export const BACKGROUNDS: Record<CollageBg, { label: string; fill: string; text: string; sub: string; frame: string }> = {
  slate: { label: "Dark slate", fill: "#1e2430", text: "#f8fafc", sub: "#cbd5e1", frame: "#f8fafc" },
  white: { label: "Pure white", fill: "#ffffff", text: "#111827", sub: "#4b5563", frame: "#ffffff" },
  sand: { label: "Warm sand", fill: "#eadcc4", text: "#3b2e20", sub: "#6b5a45", frame: "#fffaf1" },
};

export interface CollageOptions {
  style: CollageStyle;
  ratio: CollageRatio;
  bg: CollageBg;
  /** Frame border thickness, 0..10 (relative units) */
  border: number;
  /** Gap between frames, 0..40 (relative units) */
  gap: number;
  title: string;
  showTitle: boolean;
  /** Bottom-right credit; null = off */
  watermark: string | null;
  /** Location subtitles (postcard strip) */
  captions: boolean;
  /** Changes the scrapbook tilt / jitter */
  seed: number;
}

export interface CollageItem {
  img: CanvasImageSource;
  w: number;
  h: number;
  caption?: string | null;
}

/** Long edge of the exported PNG */
export const EXPORT_LONG_EDGE = 2400;
export const MAX_COLLAGE_PHOTOS = 10;

export function canvasSize(ratio: CollageRatio, longEdge: number): { W: number; H: number } {
  if (ratio === "1:1") return { W: longEdge, H: longEdge };
  const short = Math.round((longEdge * 10) / 16);
  return ratio === "10:16" ? { W: short, H: longEdge } : { W: longEdge, H: short };
}

/* ------------------------------------------------------------------ */
/* Photo picking                                                       */
/* ------------------------------------------------------------------ */

const SCENIC = /landscape|nature|mountain|waterfall|sunset|sunrise|golden|blue ?hour|beach|lake|sea|ocean|glacier|canyon|forest|aerial|drone|coast|view|scenic|valley|volcano|desert|river|bridge|skyline|cityscape|island|cliff|fjord|aurora|milky ?way|panorama|travel/i;
const UNSCENIC = /selfie|portrait|people|food|document|screenshot|receipt/i;

/** Higher = more of a scenic, collage-worthy shot */
export function scenicScore(p: Pin): number {
  const tags = (p.tags ?? []).join(" ");
  let s = 0;
  if (SCENIC.test(tags) || SCENIC.test(p.title ?? "")) s += 3;
  if (UNSCENIC.test(tags)) s -= 3;
  if (p.solar_phase === "sunrise" || p.solar_phase === "sunset" || p.solar_phase === "blue") s += 2;
  if (p.width && p.height && p.width > p.height) s += 1;
  return s;
}

/** Up to `n` scenic photos, preferring a different place for each */
export function pickScenic(pins: Pin[], n = 9): Pin[] {
  const ranked = [...pins].sort((a, b) => scenicScore(b) - scenicScore(a) || (b.ts ?? 0) - (a.ts ?? 0));
  const out: Pin[] = [];
  const places = new Set<string>();
  for (const p of ranked) {
    if (out.length >= n) break;
    const key = p.location_name?.trim().toLowerCase() ?? `${p.latitude.toFixed(2)},${p.longitude.toFixed(2)}`;
    if (places.has(key)) continue;
    places.add(key);
    out.push(p);
  }
  for (const p of ranked) {
    if (out.length >= n) break;
    if (!out.includes(p)) out.push(p);
  }
  return out;
}

export function shuffled<T>(a: T[]): T[] {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

/* ------------------------------------------------------------------ */
/* Image loading (CORS-safe so the canvas can be exported)             */
/* ------------------------------------------------------------------ */

const imgCache = new Map<string, Promise<HTMLImageElement>>();

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

/** Direct (CORS) first; hosts without CORS headers go through /api/image-proxy */
export function loadCollageImage(url: string): Promise<HTMLImageElement> {
  let p = imgCache.get(url);
  if (!p) {
    p = loadImg(url).catch(() => loadImg(`/api/image-proxy?url=${encodeURIComponent(url)}`));
    p.catch(() => imgCache.delete(url));
    imgCache.set(url, p);
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Drawing                                                             */
/* ------------------------------------------------------------------ */

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Seeded PRNG (mulberry32): the same seed draws the same scrapbook */
function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** drawImage with object-fit: cover */
function drawCover(ctx: CanvasRenderingContext2D, it: CollageItem, r: Rect) {
  const ar = it.w / it.h;
  const rr = r.w / r.h;
  let sw = it.w;
  let sh = it.h;
  if (ar > rr) sw = it.h * rr;
  else sh = it.w / rr;
  ctx.drawImage(it.img, (it.w - sw) / 2, (it.h - sh) / 2, sw, sh, r.x, r.y, r.w, r.h);
}

/** Photo with an optional inner frame of `bw` */
function framed(ctx: CanvasRenderingContext2D, it: CollageItem, r: Rect, bw: number, frame: string) {
  if (bw > 0) {
    ctx.fillStyle = frame;
    ctx.fillRect(r.x, r.y, r.w, r.h);
    drawCover(ctx, it, { x: r.x + bw, y: r.y + bw, w: Math.max(1, r.w - 2 * bw), h: Math.max(1, r.h - 2 * bw) });
  } else drawCover(ctx, it, r);
}

function setSpacing(ctx: CanvasRenderingContext2D, px: number) {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${px}px`;
}

/** Shrinks the font until the text fits `maxW` */
function fitFont(ctx: CanvasRenderingContext2D, text: string, weight: string, size: number, family: string, maxW: number): number {
  let s = size;
  ctx.font = `${weight} ${s}px ${family}`;
  while (s > 8 && ctx.measureText(text).width > maxW) {
    s *= 0.92;
    ctx.font = `${weight} ${s}px ${family}`;
  }
  return s;
}

const SANS = "Inter, 'Helvetica Neue', Arial, system-ui, sans-serif";
const SERIF = "Georgia, 'Times New Roman', serif";

/* ---------- layouts ---------- */

/** Justified rows: every photo keeps (almost) its own aspect ratio */
function masonryRects(items: CollageItem[], area: Rect, gap: number): Rect[] {
  const n = items.length;
  const ars = items.map((i) => i.w / i.h);
  let best: { rows: number[][]; heights: number[]; err: number } | null = null;
  for (let k = 1; k <= n; k++) {
    // Greedy split into k rows of similar total aspect
    const total = ars.reduce((a, b) => a + b, 0);
    const target = total / k;
    const rows: number[][] = [];
    let cur: number[] = [];
    let sum = 0;
    for (let i = 0; i < n; i++) {
      cur.push(i);
      sum += ars[i];
      const rowsAfter = k - rows.length - 1;
      const itemsAfter = n - i - 1;
      if (rowsAfter > 0 && (sum >= target * 0.92 || itemsAfter === rowsAfter)) {
        rows.push(cur);
        cur = [];
        sum = 0;
      }
    }
    if (cur.length) rows.push(cur);
    if (rows.length !== k) continue;
    const heights = rows.map((r) => (area.w - gap * (r.length - 1)) / r.reduce((a, i) => a + ars[i], 0));
    const totalH = heights.reduce((a, b) => a + b, 0) + gap * (k - 1);
    const err = Math.abs(Math.log(totalH / area.h));
    if (!best || err < best.err) best = { rows, heights, err };
  }
  if (!best) return [];
  const scale = (area.h - gap * (best.rows.length - 1)) / best.heights.reduce((a, b) => a + b, 0);
  const out: Rect[] = new Array(n);
  let y = area.y;
  best.rows.forEach((row, ri) => {
    const h = best!.heights[ri] * scale;
    const sumAr = row.reduce((a, i) => a + ars[i], 0);
    let x = area.x;
    const free = area.w - gap * (row.length - 1);
    row.forEach((i, j) => {
      const w = j === row.length - 1 ? area.x + area.w - x : (free * ars[i]) / sumAr;
      out[i] = { x, y, w, h };
      x += w + gap;
    });
    y += h + gap;
  });
  return out;
}

/** Cells of a grid; the last row stretches to fill the width */
function gridRects(n: number, area: Rect, gap: number, cols: number): Rect[] {
  const rows = Math.ceil(n / cols);
  const h = (area.h - gap * (rows - 1)) / rows;
  const out: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    const inRow = Math.min(cols, n - r * cols);
    const w = (area.w - gap * (inRow - 1)) / inRow;
    for (let c = 0; c < inRow; c++) out.push({ x: area.x + c * (w + gap), y: area.y + r * (h + gap), w, h });
  }
  return out;
}

function heroRects(n: number, area: Rect, gap: number): Rect[] {
  if (n === 1) return [area];
  const rest = n - 1;
  const horizontal = area.w > area.h * 1.15;
  if (horizontal) {
    const hw = area.w * (rest <= 2 ? 0.62 : 0.56);
    const hero = { x: area.x, y: area.y, w: hw, h: area.h };
    const side = { x: area.x + hw + gap, y: area.y, w: area.w - hw - gap, h: area.h };
    const cols = rest <= 2 ? 1 : rest <= 6 ? 2 : 3;
    return [hero, ...gridRects(rest, side, gap, cols)];
  }
  const hh = area.h * (rest <= 4 ? 0.56 : 0.5);
  const hero = { x: area.x, y: area.y, w: area.w, h: hh };
  const below = { x: area.x, y: area.y + hh + gap, w: area.w, h: area.h - hh - gap };
  const cols = rest <= 2 ? rest : rest <= 4 ? 2 : rest <= 6 ? 3 : 4;
  return [hero, ...gridRects(rest, below, gap, cols)];
}

function drawScrapbook(ctx: CanvasRenderingContext2D, items: CollageItem[], area: Rect, o: CollageOptions, u: number) {
  const n = items.length;
  const rand = rng(o.seed * 9973 + n);
  const portraitCanvas = area.h > area.w;
  // Grid with the biggest cards for the photos' average shape
  const avgAr = items.reduce((a, i) => a + i.w / i.h, 0) / n;
  let cols = 1;
  let bestArea = 0;
  for (let c = 1; c <= n; c++) {
    const rs = Math.ceil(n / c);
    const w = Math.min(area.w / c, (area.h / rs) * avgAr);
    if (w * (w / avgAr) > bestArea * 1.02) {
      bestArea = w * (w / avgAr);
      cols = c;
    }
  }
  const rows = Math.ceil(n / cols);
  const cw = area.w / cols;
  const ch = area.h / rows;
  const frame = BACKGROUNDS[o.bg].frame === "#ffffff" && o.bg === "white" ? "#f3f4f6" : BACKGROUNDS[o.bg].frame;
  const bw = (4 + o.border * 2.2) * u;
  const order = items.map((_, i) => i).sort(() => rand() - 0.5);
  for (const i of order) {
    const it = items[i];
    const r = Math.floor(i / cols);
    const inRow = Math.min(cols, n - r * cols);
    const offset = (cols - inRow) * cw * 0.5;
    const c = i % cols;
    const cx = area.x + offset + c * cw + cw / 2 + (rand() - 0.5) * cw * 0.14;
    const cy = area.y + r * ch + ch / 2 + (rand() - 0.5) * ch * 0.14;
    // Contain-fit inside an enlarged cell (cards overlap their neighbours a little): never crops the photo
    const boxW = cw * 1.14 - o.gap * u * 0.5;
    const boxH = ch * 1.14 - o.gap * u * 0.5;
    const ar = it.w / it.h;
    let w = boxW - 2 * bw;
    let h = w / ar;
    if (h > boxH - 2 * bw - bw) {
      h = boxH - 3 * bw;
      w = h * ar;
    }
    const angle = ((rand() * 10 - 5) * Math.PI) / 180;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 22 * u;
    ctx.shadowOffsetY = 8 * u;
    const fw = w + 2 * bw;
    const fh = h + 2 * bw + bw * (portraitCanvas ? 1.2 : 0.8);
    ctx.fillStyle = frame;
    ctx.fillRect(-fw / 2, -fh / 2, fw, fh);
    ctx.shadowColor = "transparent";
    drawCover(ctx, it, { x: -fw / 2 + bw, y: -fh / 2 + bw, w, h });
    ctx.restore();
  }
}

function drawPostcard(ctx: CanvasRenderingContext2D, items: CollageItem[], area: Rect, o: CollageOptions, u: number, gap: number) {
  const pal = BACKGROUNDS[o.bg];
  const n = items.length;
  const asColumns = area.w > area.h * 1.15;
  const bw = o.border * 1.6 * u;
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const r: Rect = asColumns
      ? { x: area.x + i * ((area.w - gap * (n - 1)) / n + gap), y: area.y, w: (area.w - gap * (n - 1)) / n, h: area.h }
      : { x: area.x, y: area.y + i * ((area.h - gap * (n - 1)) / n + gap), w: area.w, h: (area.h - gap * (n - 1)) / n };
    framed(ctx, it, r, bw, pal.frame);
    const label = it.caption?.split(",")[0]?.trim();
    if (o.captions && label) {
      const inner = { x: r.x + bw, y: r.y + bw, w: r.w - 2 * bw, h: r.h - 2 * bw };
      const band = Math.min(inner.h * 0.32, 90 * u);
      const g = ctx.createLinearGradient(0, inner.y + inner.h - band, 0, inner.y + inner.h);
      g.addColorStop(0, "rgba(0,0,0,0)");
      g.addColorStop(1, "rgba(0,0,0,0.72)");
      ctx.fillStyle = g;
      ctx.fillRect(inner.x, inner.y + inner.h - band, inner.w, band);
      ctx.fillStyle = "#ffffff";
      ctx.textBaseline = "alphabetic";
      ctx.textAlign = "left";
      setSpacing(ctx, 3 * u);
      const text = label.toUpperCase();
      fitFont(ctx, text, "700", 22 * u, SANS, inner.w - 36 * u);
      ctx.fillText(text, inner.x + 18 * u, inner.y + inner.h - 18 * u);
      setSpacing(ctx, 0);
    }
  }
}

/**
 * Draws the whole collage on a canvas of W×H. Every size is relative to the long edge, so the small live preview and
 * the 2400px export look the same.
 */
export function drawCollage(ctx: CanvasRenderingContext2D, W: number, H: number, items: CollageItem[], o: CollageOptions) {
  const u = Math.max(W, H) / 1000;
  const pal = BACKGROUNDS[o.bg];
  ctx.save();
  ctx.fillStyle = pal.fill;
  ctx.fillRect(0, 0, W, H);
  ctx.imageSmoothingQuality = "high";

  const margin = Math.max(18 * u, o.gap * u);
  const gap = o.gap * u;
  const title = o.showTitle ? o.title.trim() : "";
  const titleBand = title ? (o.style === "postcard" ? 120 : 100) * u : 0;
  const footer = o.watermark ? 34 * u : 0;
  const area: Rect = { x: margin, y: margin + titleBand, w: W - 2 * margin, h: H - 2 * margin - titleBand - footer };

  if (title) {
    ctx.fillStyle = pal.text;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const text = o.style === "postcard" ? title : title.toUpperCase();
    if (o.style === "postcard") fitFont(ctx, text, "italic 700", 58 * u, SERIF, W - 2 * margin);
    else {
      setSpacing(ctx, 10 * u);
      fitFont(ctx, text, "800", 46 * u, SANS, W - 2 * margin);
    }
    ctx.fillText(text, W / 2, margin + titleBand / 2 - 4 * u);
    setSpacing(ctx, 0);
  }

  if (items.length) {
    if (o.style === "scrapbook") drawScrapbook(ctx, items, area, o, u);
    else if (o.style === "postcard") drawPostcard(ctx, items.slice(0, 5), area, o, u, gap);
    else {
      const rects = o.style === "masonry" ? masonryRects(items, area, gap) : heroRects(Math.min(items.length, 9), area, gap);
      const bw = o.border * 1.6 * u;
      rects.forEach((r, i) => items[i] && framed(ctx, items[i], r, bw, pal.frame));
    }
  }

  if (o.watermark) {
    ctx.fillStyle = pal.sub;
    ctx.globalAlpha = 0.85;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    setSpacing(ctx, 2 * u);
    ctx.font = `600 ${15 * u}px ${SANS}`;
    ctx.fillText(o.watermark, W - margin, H - margin / 2 - footer / 2 + 2 * u);
    setSpacing(ctx, 0);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

/** Renders the export canvas and resolves its PNG / JPEG blob */
export async function renderCollageBlob(items: CollageItem[], o: CollageOptions, type: "image/png" | "image/jpeg" = "image/png"): Promise<Blob> {
  const { W, H } = canvasSize(o.ratio, EXPORT_LONG_EDGE);
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available in this browser");
  drawCollage(ctx, W, H, items, o);
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not export the collage"))), type, type === "image/jpeg" ? 0.9 : undefined),
  );
}
