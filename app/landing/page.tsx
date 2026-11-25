import type { Metadata } from "next";
import Link from "next/link";
import { GoogleCta, Pricing } from "@/components/landing/LandingClient";

export const metadata: Metadata = {
  title: "Features & Pricing · StoryMap",
  description:
    "Your travel archive, mapped by light. 4K EXIF/GPS mapping, Golden Hour and Blue Hour tagging, AI visual search, Collage Studio and curated photography itineraries.",
  openGraph: {
    title: "StoryMap: Your Travel Archive, Mapped by Light & Ready to Explore",
    description: "4K EXIF/GPS mapping, solar-phase tagging, AI visual search, Collage Studio and Ready Routes for photographers.",
    url: "https://my-storymap.netlify.app/landing",
    siteName: "StoryMap",
    type: "website",
  },
};

interface Pillar {
  icon: string;
  title: string;
  body: string;
  badges: string[];
  accent: string;
}

const PILLARS: Pillar[] = [
  {
    icon: "🗺️",
    title: "Interactive 4K Map & EXIF/Gear Extraction",
    body: "Every photo pins itself from your camera's GPS. Camera, lens, aperture, shutter and ISO are read for you, and ▯ / ▭ filters split portrait from landscape in one tap.",
    badges: ["GPS auto-pins", "Camera & lens", "▯ ▭ filter"],
    accent: "from-sky-400/25",
  },
  {
    icon: "🌅",
    title: "Astronomical Light Phase Engine",
    body: "From exact coordinates and capture time, StoryMap works out whether a shot was Sunrise, Golden Hour, Sunset, Blue Hour or Night, so you can search your archive by light.",
    badges: ["Sunrise", "Golden Hour", "Blue Hour", "Night"],
    accent: "from-amber-400/25",
  },
  {
    icon: "🔎",
    title: "AI Visual Search & Auto-Tagging",
    body: "Ask in plain words: “10 bridges in Europe” or “waterfalls at sunset”. Prefer no AI? Upload in zero-credit manual / EXIF-only mode.",
    badges: ["Natural language", "Auto-tags", "Zero-credit mode"],
    accent: "from-violet-400/25",
  },
  {
    icon: "✨",
    title: "Collage Studio",
    body: "Four built-in styles (Dynamic Scrapbook, Editorial Masonry, Hero + Grid, Postcard Strip) exported at 10:16 or 16:10, 2048 px and up, ready for Stories and posts.",
    badges: ["4 styles", "10:16 · 16:10", "2048 px+"],
    accent: "from-pink-400/25",
  },
  {
    icon: "🧭",
    title: "Ready Routes & 2 km Photo Walk",
    body: "Multi-day photography itineraries with the best light window for each stop, parking and drone tips, Google Maps navigation and GPX / Excel export. Or find what else is within 2 km.",
    badges: ["Light windows", "Parking & drone", "GPX · Excel"],
    accent: "from-emerald-400/25",
  },
  {
    icon: "⚡",
    title: "Content Lab Workflow Sync",
    body: "Send any photo or collage to PAST, EVERGREEN or A Bank of Ideas in one click. The live /api/routes feed keeps social Comment-to-DM automations in sync with your routes.",
    badges: ["PAST", "EVERGREEN", "A Bank of Ideas", "/api/routes"],
    accent: "from-orange-400/25",
  },
];

/** The sun's path across the sky with the five light phases StoryMap tags */
function LightArc() {
  const phases = [
    { x: 40, y: 262, label: "Blue Hour", c: "#60a5fa" },
    { x: 118, y: 196, label: "Sunrise", c: "#fb923c" },
    { x: 220, y: 120, label: "Golden Hour", c: "#fcd34d" },
    { x: 420, y: 120, label: "Golden Hour", c: "#fcd34d" },
    { x: 522, y: 196, label: "Sunset", c: "#f97316" },
    { x: 600, y: 262, label: "Blue Hour", c: "#60a5fa" },
  ];
  return (
    <svg viewBox="0 0 640 300" className="h-auto w-full" role="img" aria-label="The sun's arc with Blue Hour, Sunrise, Golden Hour, Sunset and Blue Hour marked">
      <defs>
        <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#0f172a" />
          <stop offset="0.7" stopColor="#1e293b" />
          <stop offset="1" stopColor="#7c2d12" stopOpacity="0.55" />
        </linearGradient>
        <radialGradient id="sun" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#fde68a" />
          <stop offset="0.5" stopColor="#fbbf24" stopOpacity="0.6" />
          <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="640" height="300" rx="28" fill="url(#sky)" />
      <path d="M20 280 Q320 -40 620 280" fill="none" stroke="#fcd34d" strokeOpacity="0.35" strokeWidth="2" strokeDasharray="4 7" />
      <circle cx="320" cy="72" r="46" fill="url(#sun)" />
      <circle cx="320" cy="72" r="13" fill="#fef3c7" />
      <line x1="0" y1="280" x2="640" y2="280" stroke="#e2e8f0" strokeOpacity="0.25" />
      <path d="M0 280 L90 236 L150 258 L230 214 L300 252 L380 222 L450 256 L540 226 L640 262 L640 300 L0 300 Z" fill="#020617" fillOpacity="0.85" />
      {phases.map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="6" fill={p.c} />
          <circle cx={p.x} cy={p.y} r="12" fill={p.c} fillOpacity="0.18" />
          <text x={p.x} y={p.y - 18} textAnchor="middle" fontSize="13" fontWeight="600" fill="#e2e8f0">{p.label}</text>
        </g>
      ))}
      <text x="320" y="150" textAnchor="middle" fontSize="12" fill="#94a3b8">Night</text>
    </svg>
  );
}

const section = "mx-auto w-full max-w-6xl px-5";

export default function LandingPage() {
  return (
    <main className="min-h-dvh bg-slate-950 text-neutral-200 antialiased">
      {/* Nav */}
      <nav className="sticky top-0 z-40 border-b border-white/5 bg-slate-950/80 backdrop-blur">
        <div className={`${section} flex h-16 items-center gap-6`}>
          <Link href="/" className="text-sm font-black tracking-[0.25em] text-white">
            STORY<span className="text-amber-300">MAP</span>
          </Link>
          <div className="hidden gap-5 text-sm text-neutral-400 sm:flex">
            <a href="#features" className="hover:text-white">Features</a>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <Link href="/?view=routes" className="hover:text-white">Ready Routes</Link>
          </div>
          <Link href="/" className="ml-auto rounded-xl bg-white/10 px-3.5 py-2 text-sm font-semibold text-white hover:bg-white/20">Open the map</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-amber-500/10 blur-3xl" />
        <div className={`${section} relative grid items-center gap-12 py-16 md:py-24 lg:grid-cols-[1.1fr_1fr]`}>
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-amber-300/30 bg-amber-300/10 px-3 py-1 text-xs font-semibold text-amber-200">
              <span aria-hidden>●</span> Free during Beta
            </p>
            <h1 className="mt-5 text-4xl font-bold leading-[1.08] tracking-tight text-white sm:text-5xl lg:text-6xl">
              Your Travel Archive, Mapped by <span className="bg-gradient-to-r from-amber-200 via-amber-300 to-orange-400 bg-clip-text text-transparent">Light</span> &amp; Ready to Explore
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-neutral-300">
              Drop in your shots and StoryMap pins them from 4K EXIF &amp; GPS, tags every frame with its astronomical light phase (Golden Hour, Blue Hour and more),
              finds anything with AI visual search, turns favourites into Collage Studio layouts, and hands you curated photography itineraries.
            </p>
            <div className="mt-8 flex flex-wrap items-start gap-3">
              <GoogleCta />
              <Link href="/?view=routes" className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-white/15 px-6 text-base font-semibold text-white transition hover:border-white/30 hover:bg-white/5">
                <span aria-hidden>🗺️</span> Explore Ready Routes
              </Link>
            </div>
            <p className="mt-4 text-xs text-neutral-500">No card needed. We only use your email and basic profile.</p>
          </div>

          <div className="relative">
            <div className="overflow-hidden rounded-[28px] shadow-2xl ring-1 ring-white/10">
              <LightArc />
            </div>
            <div className="mt-4 rounded-2xl border border-white/10 bg-slate-900/90 p-3.5 shadow-xl backdrop-blur sm:absolute sm:-bottom-6 sm:right-[-12px] sm:mt-0 sm:w-72">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Skógafoss · Iceland</p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                <span className="rounded-full bg-amber-300/15 px-2 py-0.5 text-amber-200">✨ Golden Hour · 21:47</span>
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-neutral-200">▭ Landscape</span>
              </div>
              <p className="mt-2 font-mono text-[11px] leading-relaxed text-neutral-400">24–70 mm · f/8 · 1/250 s · ISO 100<br />63.5321° N, 19.5114° W</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pillars */}
      <section id="features" className={`${section} scroll-mt-20 py-20`}>
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">Everything in one map</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Six tools that think like a photographer</h2>
          <p className="mt-4 text-neutral-400">From the moment a file leaves your camera to the itinerary you share with followers.</p>
        </div>
        <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <li key={p.title} className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-white/20 hover:bg-white/[0.05]">
              <div aria-hidden className={`pointer-events-none absolute -right-10 -top-10 h-36 w-36 rounded-full bg-gradient-to-br ${p.accent} to-transparent blur-2xl`} />
              <span className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 text-2xl" aria-hidden>{p.icon}</span>
              <h3 className="relative mt-5 text-lg font-semibold leading-snug text-white">{p.title}</h3>
              <p className="relative mt-2 text-sm leading-relaxed text-neutral-400">{p.body}</p>
              <div className="relative mt-4 flex flex-wrap gap-1.5">
                {p.badges.map((b) => (
                  <span key={b} className="rounded-full border border-white/10 bg-black/30 px-2.5 py-0.5 text-[11px] font-medium text-neutral-300">{b}</span>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-20 border-y border-white/5 bg-slate-900/40 py-20">
        <div className={section}>
          <div className="mx-auto max-w-2xl text-center">
            <p className="text-xs font-bold uppercase tracking-[0.25em] text-amber-300">Pricing</p>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">Start free. Upgrade when your archive grows.</h2>
            <p className="mt-4 text-neutral-400">Pay yearly and save 25%. Every paid plan is free while StoryMap is in beta.</p>
          </div>
          <div className="mt-10">
            <Pricing />
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className={`${section} py-20 text-center`}>
        <h2 className="text-3xl font-bold tracking-tight text-white sm:text-4xl">Put your best light on the map</h2>
        <p className="mx-auto mt-4 max-w-xl text-neutral-400">Sign in with Google and your first photos are pinned and light-tagged in minutes.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <GoogleCta />
          <Link href="/?view=routes" className="inline-flex min-h-12 items-center gap-2 rounded-2xl border border-white/15 px-6 text-base font-semibold text-white transition hover:border-white/30 hover:bg-white/5">
            <span aria-hidden>🗺️</span> Explore Ready Routes
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-white/5">
        <div className={`${section} flex flex-col items-center gap-4 py-8 text-sm text-neutral-500 sm:flex-row`}>
          <Link href="/" className="text-xs font-black tracking-[0.25em] text-white">
            STORY<span className="text-amber-300">MAP</span>
          </Link>
          <nav aria-label="Footer" className="flex flex-wrap justify-center gap-5 sm:ml-auto">
            <Link href="/" className="hover:text-white">Live Map</Link>
            <Link href="/?view=routes" className="hover:text-white">Ready Routes</Link>
            <a href="#pricing" className="hover:text-white">Pricing</a>
            <Link href="/privacy" className="hover:text-white">Privacy</Link>
          </nav>
          <p className="text-xs">© {new Date().getFullYear()} StoryMap</p>
        </div>
      </footer>
    </main>
  );
}
