import { NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_BYTES = 6 * 1024 * 1024;

/** StoryMap's own image hosts only (Supabase Storage, R2 public bucket, EXTERNAL_IMAGE_HOSTS): never an open proxy */
function allowedHosts(): Set<string> {
  const hosts = new Set<string>();
  for (const v of [process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.R2_PUBLIC_URL]) {
    try {
      if (v) hosts.add(new URL(v).host.toLowerCase());
    } catch {
      /* ignore malformed env */
    }
  }
  for (const h of (process.env.EXTERNAL_IMAGE_HOSTS ?? "").split(",")) if (h.trim()) hosts.add(h.trim().toLowerCase());
  return hosts;
}

/**
 * GET /api/image-proxy?url=<photo url>
 * Re-serves a StoryMap photo from our own origin so the Collage Studio canvas can be exported
 * when the storage host sends no CORS headers.
 */
export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("url");
  let target: URL;
  try {
    target = new URL(raw ?? "");
  } catch {
    return NextResponse.json({ error: "Bad url" }, { status: 400 });
  }
  const host = target.host.toLowerCase();
  if (target.protocol !== "https:" || !allowedHosts().has(host)) {
    return NextResponse.json({ error: "Host not allowed" }, { status: 403 });
  }
  const res = await fetch(target, { redirect: "error" }).catch(() => null);
  if (!res || !res.ok) return NextResponse.json({ error: "Upstream failed" }, { status: 502 });
  const type = res.headers.get("content-type") ?? "";
  if (!type.startsWith("image/")) return NextResponse.json({ error: "Not an image" }, { status: 415 });
  const buf = await res.arrayBuffer();
  if (buf.byteLength > MAX_BYTES) return NextResponse.json({ error: "Image too large" }, { status: 413 });
  return new NextResponse(buf, {
    headers: {
      "Content-Type": type,
      "Cache-Control": "public, max-age=86400, s-maxage=604800, immutable",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
