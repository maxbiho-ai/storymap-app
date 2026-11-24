"use client";

/** Reference ("shot list") photos of a stop: small JPEG data URLs, so a saved trip carries them with it */

const MAX_EDGE = 560;
const QUALITY = 0.68;

/** Any image blob → a ~560px JPEG data URL (about 25-45 KB) */
export async function blobToRefPhoto(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const k = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const w = Math.max(1, Math.round(bmp.width * k));
  const h = Math.max(1, Math.round(bmp.height * k));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return canvas.toDataURL("image/jpeg", QUALITY);
}

/** A StoryMap photo by URL: compressed into a data URL when the host allows reading it, else the URL itself */
export async function urlToRefPhoto(url: string): Promise<string> {
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return url;
    return await blobToRefPhoto(await res.blob());
  } catch {
    return url;
  }
}

/** First image in the system clipboard (Paste button), or null */
export async function readClipboardImage(): Promise<Blob | null> {
  if (!navigator.clipboard?.read) return null;
  const items = await navigator.clipboard.read();
  for (const it of items) {
    const type = it.types.find((t) => t.startsWith("image/"));
    if (type) return it.getType(type);
  }
  return null;
}

/** First image of a paste event (Ctrl+V) */
export function imageFromPaste(e: { clipboardData: DataTransfer | null }): File | null {
  for (const f of Array.from(e.clipboardData?.files ?? [])) if (f.type.startsWith("image/")) return f;
  for (const it of Array.from(e.clipboardData?.items ?? [])) if (it.type.startsWith("image/")) return it.getAsFile();
  return null;
}
