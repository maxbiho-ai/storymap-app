"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/hooks/useAuth";
import { getSupabase } from "@/lib/supabase/client";

const GoogleLogo = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3A12 12 0 1112 24a12 12 0 018-3l5.7-5.7A20 20 0 1044 24c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0124 12c3 0 5.8 1.1 8 3l5.7-5.7A20 20 0 006.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3A12 12 0 0112.7 28l-6.5 5A20 20 0 0024 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 01-4.1 5.5l6.3 5.3C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
);

/** Google OAuth straight from the landing page; comes back to the map */
async function signInWithGoogle(): Promise<string | null> {
  const { error } = await getSupabase().auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/` } });
  return error ? error.message : null;
}

function useGoogle() {
  const { user, loading } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async () => {
    if (user) {
      window.location.href = "/";
      return;
    }
    setBusy(true);
    setError(null);
    const err = await signInWithGoogle();
    // On success the browser leaves for Google; only errors come back here
    if (err) {
      setError(err);
      setBusy(false);
    }
  };
  return { user, loading, busy, error, go };
}

/** Hero / final CTA: "Get Started Free (Google Sign-In)", or "Open your map" when already signed in */
export function GoogleCta({ className = "" }: { className?: string }) {
  const { user, busy, error, go } = useGoogle();
  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy}
        className="inline-flex min-h-12 items-center gap-3 rounded-2xl bg-amber-300 px-6 text-base font-semibold text-neutral-950 shadow-lg shadow-amber-300/20 transition hover:bg-amber-200 disabled:opacity-60"
      >
        {user ? (
          <>Open your map →</>
        ) : (
          <>
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white"><GoogleLogo /></span>
            {busy ? "Opening Google…" : "Get Started Free (Google Sign-In)"}
          </>
        )}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
    </div>
  );
}

type Billing = "monthly" | "annual";

interface Tier {
  id: "explorer" | "pro" | "creator";
  name: string;
  tagline: string;
  monthly: number;
  annual: number;
  popular?: boolean;
  features: string[];
}

const TIERS: Tier[] = [
  {
    id: "explorer",
    name: "Explorer",
    tagline: "Free forever",
    monthly: 0,
    annual: 0,
    features: [
      "Browse Ready Routes with starter tips",
      "Up to 100 geotagged photos (EXIF / GPS, no AI)",
      "2 km Nearby Photo Walk",
      "Google Maps export",
    ],
  },
  {
    id: "pro",
    name: "Pro Photographer",
    tagline: "For the serious light-chaser",
    monthly: 5,
    annual: 45,
    popular: true,
    features: [
      "Up to 5,000 photos in 4K",
      "300 AI photo analyses / month",
      "AI natural-language search",
      "All pro photo, parking & drone tips",
      "GPX & Excel route exports",
      "Watermark-free 4K Collage Studio",
    ],
  },
  {
    id: "creator",
    name: "Creator & Guide",
    tagline: "Publish and grow an audience",
    monthly: 10,
    annual: 90,
    features: [
      "Unlimited photos",
      "1,500 AI analyses / month",
      "Publish custom branded Ready Routes (?route=<slug>)",
      "Full Content Lab integration",
      "Everything in Pro Photographer",
    ],
  },
];

const Check = () => (
  <svg viewBox="0 0 20 20" className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden>
    <path d="M4 10.5l4 4 8-9" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

/** 3-tier pricing with a monthly / annual (25% off) toggle; paid tiers open the free-beta modal */
export function Pricing() {
  const [billing, setBilling] = useState<Billing>("annual");
  const [betaTier, setBetaTier] = useState<Tier | null>(null);
  const { user, busy, go } = useGoogle();

  return (
    <>
      <div className="flex justify-center">
        <div role="radiogroup" aria-label="Billing period" className="inline-flex rounded-full border border-white/10 bg-white/5 p-1 text-sm">
          {(["monthly", "annual"] as const).map((b) => (
            <button
              key={b}
              type="button"
              role="radio"
              aria-checked={billing === b}
              onClick={() => setBilling(b)}
              className={`rounded-full px-4 py-1.5 font-semibold transition ${billing === b ? "bg-white text-neutral-950" : "text-neutral-300 hover:text-white"}`}
            >
              {b === "monthly" ? "Monthly" : "Annual"}
              {b === "annual" && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[10px] font-bold ${billing === b ? "bg-emerald-500 text-white" : "bg-emerald-400/20 text-emerald-300"}`}>−25%</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-10 grid gap-5 lg:grid-cols-3">
        {TIERS.map((t) => {
          const free = t.monthly === 0;
          const price = billing === "monthly" ? t.monthly : t.annual;
          return (
            <article
              key={t.id}
              className={`relative flex flex-col rounded-3xl border p-6 ${t.popular ? "border-amber-300/70 bg-gradient-to-b from-amber-300/[0.09] to-white/[0.02] shadow-2xl shadow-amber-300/10 lg:-mt-3 lg:mb-3" : "border-white/10 bg-white/[0.03]"}`}
            >
              {t.popular && <span className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-amber-300 px-3 py-1 text-xs font-bold text-neutral-950">Most Popular</span>}
              <h3 className="text-lg font-semibold text-white">{t.name}</h3>
              <p className="text-sm text-neutral-400">{t.tagline}</p>
              <div className="mt-5 flex items-baseline gap-1.5">
                <span className="text-4xl font-bold tracking-tight text-white">${price}</span>
                <span className="text-sm text-neutral-400">{free ? "forever" : billing === "monthly" ? "/ month" : "/ year"}</span>
              </div>
              <p className="mt-1 h-5 text-xs text-neutral-500">
                {!free && billing === "annual" && <>≈ ${(t.annual / 12).toFixed(2)} / month · save ${t.monthly * 12 - t.annual} a year</>}
                {!free && billing === "monthly" && <>or ${t.annual} / year with annual billing</>}
              </p>
              {!free && (
                <p className="mt-3 inline-flex w-fit items-center gap-1.5 rounded-full bg-emerald-400/15 px-2.5 py-1 text-[11px] font-semibold text-emerald-300">
                  <span aria-hidden>●</span> Free during Beta
                </p>
              )}
              <ul className="mt-5 flex-1 space-y-2.5 text-sm text-neutral-200">
                {t.features.map((f) => (
                  <li key={f} className="flex gap-2.5"><Check />{f}</li>
                ))}
              </ul>
              <button
                type="button"
                disabled={busy}
                onClick={() => (free ? void go() : setBetaTier(t))}
                className={`mt-6 min-h-11 rounded-xl px-4 text-sm font-semibold transition disabled:opacity-60 ${t.popular ? "bg-amber-300 text-neutral-950 hover:bg-amber-200" : "bg-white/10 text-white hover:bg-white/20"}`}
              >
                {free ? (user ? "Open your map" : "Start free with Google") : `Join the Beta: ${t.name}`}
              </button>
            </article>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-neutral-500">Prices in USD. During the beta every plan is free for invited testers: no card, no paywall.</p>

      {betaTier && <BetaModal tier={betaTier} billing={billing} onClose={() => setBetaTier(null)} />}
    </>
  );
}

function BetaModal({ tier, billing, onClose }: { tier: Tier; billing: Billing; onClose: () => void }) {
  const { user, busy, error, go } = useGoogle();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return createPortal(
    <div role="dialog" aria-modal="true" aria-labelledby="beta-title" className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="w-full max-w-md rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-100 shadow-2xl">
        <div className="flex items-start justify-between">
          <p className="text-xs font-black tracking-[0.25em] text-white">STORY<span className="text-amber-300">MAP</span></p>
          <button type="button" onClick={onClose} aria-label="Close" className="-mt-1 text-2xl leading-none text-neutral-500 hover:text-white">×</button>
        </div>
        <h2 id="beta-title" className="mt-4 text-xl font-semibold text-white">Join Early Access / Beta</h2>
        <p className="mt-3 inline-flex items-center gap-2 rounded-full border border-emerald-400/30 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-200">
          <span aria-hidden>✓</span> Free during Beta — Sign in with Google to unlock
        </p>
        <p className="mt-4 text-sm leading-relaxed text-neutral-300">
          <strong className="text-white">{tier.name}</strong> will be ${billing === "monthly" ? `${tier.monthly} / month` : `${tier.annual} / year`} after launch. While StoryMap is in beta
          there&apos;s no payment and no card: sign in and start using it. Invited testers get their creator access straight away.
        </p>
        <ul className="mt-4 space-y-1.5 text-sm text-neutral-300">
          {tier.features.slice(0, 4).map((f) => (
            <li key={f} className="flex gap-2"><Check />{f}</li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => void go()}
          disabled={busy}
          className="mt-6 flex min-h-12 w-full items-center justify-center gap-3 rounded-xl bg-white px-4 text-sm font-semibold text-neutral-950 transition hover:bg-neutral-200 disabled:opacity-60"
        >
          {user ? "You're signed in: open the map →" : (<><GoogleLogo /> {busy ? "Opening Google…" : "Continue with Google"}</>)}
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-red-300">{error}</p>}
        <p className="mt-4 text-center text-[11px] text-neutral-500">
          By continuing you agree to our <a href="/privacy" className="underline-offset-2 hover:text-neutral-300 hover:underline">Privacy Policy</a>. We only receive your email and basic profile.
        </p>
      </div>
    </div>,
    document.body,
  );
}
