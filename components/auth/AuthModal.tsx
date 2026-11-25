"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase/client";

type Mode = "login" | "signup" | "forgot" | "recovery";

/** Friendlier Supabase Auth error messages */
function translateError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password";
  if (m.includes("email not confirmed")) return "Please confirm your email first: check your inbox";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Try logging in";
  if (m.includes("password should be at least")) return "Password is too short: at least 6 characters";
  if (m.includes("same password") || m.includes("different from the old")) return "Pick a password different from your old one";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please try again in a few minutes";
  if (m.includes("provider is not enabled") || m.includes("unsupported provider")) return "This sign-in method isn't enabled yet. Enable the provider in Supabase → Authentication → Providers";
  if (m.includes("invalid") && m.includes("email")) return "Invalid email address";
  return msg;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialMode?: Mode;
  /** Returned from the password-recovery email link: show "set a new password" */
  recovery?: boolean;
}

const GoogleLogo = () => (
  <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3A12 12 0 1112 24a12 12 0 018-3l5.7-5.7A20 20 0 1044 24c0-1.3-.1-2.6-.4-3.9z" />
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8A12 12 0 0124 12c3 0 5.8 1.1 8 3l5.7-5.7A20 20 0 006.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.2l-6.3-5.3A12 12 0 0112.7 28l-6.5 5A20 20 0 0024 44z" />
    <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 01-4.1 5.5l6.3 5.3C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
  </svg>
);
const Eye = ({ off }: { off?: boolean }) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z" />
    <circle cx="12" cy="12" r="3" />
    {off && <path d="M3 3l18 18" />}
  </svg>
);

export default function AuthModal({ open, onClose, initialMode = "login", recovery = false }: Props) {
  const [mode, setMode] = useState<Mode>(recovery ? "recovery" : initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const pwRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode(recovery ? "recovery" : initialMode);
    setError(null);
    setNotice(null);
    setShowPw(false);
    setTimeout(() => (recovery ? pwRef : emailRef).current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, initialMode, recovery, onClose]);

  if (!open) return null;

  const oauth = async (provider: "google") => {
    setBusy(true);
    setError(null);
    const { error } = await getSupabase().auth.signInWithOAuth({ provider, options: { redirectTo: window.location.origin } });
    // On success the browser leaves for the provider; only errors come back here
    if (error) {
      setError(translateError(error.message));
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);
    const supabase = getSupabase();
    try {
      if (mode === "login") {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) throw error;
        onClose();
      } else if (mode === "forgot") {
        const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
        if (error) throw error;
        setNotice(`If ${email.trim()} has an account, a reset link is on its way. Open it on this device.`);
      } else if (mode === "recovery") {
        const { error } = await supabase.auth.updateUser({ password });
        if (error) throw error;
        setNotice("Password updated. You're signed in.");
        setPassword("");
        setTimeout(onClose, 1200);
      } else {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            // ה-trigger ב-DB יוצר את הפרופיל מה-metadata הזה
            data: { full_name: fullName.trim() || null },
            emailRedirectTo: window.location.origin,
          },
        });
        if (error) throw error;
        if (data.session) {
          onClose(); // email confirmation is off in this project: signed in right away
        } else {
          setNotice(`We sent a confirmation email to ${email.trim()}. Click the link in it, then log in.`);
          setMode("login");
          setPassword("");
        }
      }
    } catch (err) {
      setError(translateError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  const input =
    "w-full rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-white placeholder:text-neutral-500 outline-none focus:border-amber-300/70 focus:ring-2 focus:ring-amber-300/20";
  const social =
    "flex w-full items-center justify-center gap-3 rounded-xl border border-white/10 bg-white/5 py-2.5 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-50";
  const title = mode === "login" ? "Log in" : mode === "signup" ? "Create account" : mode === "forgot" ? "Reset password" : "Set a new password";
  const showPassword = mode === "login" || mode === "signup" || mode === "recovery";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="max-h-[95dvh] w-full max-w-sm overflow-y-auto rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-100 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-black tracking-[0.25em] text-white">
              STORY<span className="text-amber-300">MAP</span>
            </p>
            <h2 id="auth-title" className="mt-2 text-lg font-semibold">{title}</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-neutral-500 hover:text-white">×</button>
        </div>

        {(mode === "login" || mode === "signup") && (
          <>
            <div className="space-y-2">
              <button type="button" disabled={busy} onClick={() => void oauth("google")} className={social}>
                <GoogleLogo /> Continue with Google
              </button>
            </div>
            <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-neutral-500">
              <span className="h-px flex-1 bg-white/10" /> or with email <span className="h-px flex-1 bg-white/10" />
            </div>

            {/* מעבר בין התחברות להרשמה */}
            <div className="mb-4 grid grid-cols-2 rounded-xl bg-white/5 p-1 text-sm">
              {(["login", "signup"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setError(null); setNotice(null); }}
                  className={`rounded-lg py-1.5 font-medium transition ${mode === m ? "bg-white text-neutral-900" : "text-neutral-400 hover:text-white"}`}
                >
                  {m === "login" ? "Log in" : "Sign up"}
                </button>
              ))}
            </div>
          </>
        )}

        {mode === "forgot" && <p className="mb-3 text-sm text-neutral-400">Enter your email and we&apos;ll send a link to choose a new password.</p>}
        {mode === "recovery" && <p className="mb-3 text-sm text-neutral-400">Choose a new password for your account.</p>}

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name (shown as photographer)" autoComplete="name" className={input} />
          )}
          {mode !== "recovery" && (
            <input
              ref={emailRef}
              type="email"
              required
              dir="ltr"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="email@example.com"
              autoComplete="email"
              className={input}
            />
          )}
          {showPassword && (
            <div className="relative">
              <input
                ref={pwRef}
                type={showPw ? "text" : "password"}
                required
                minLength={6}
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "login" ? "Password" : mode === "recovery" ? "New password (at least 6 characters)" : "Password (at least 6 characters)"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                className={`${input} pr-11`}
              />
              <button
                type="button"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
                aria-pressed={showPw}
                className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-neutral-400 hover:bg-white/10 hover:text-white"
              >
                <Eye off={showPw} />
              </button>
            </div>
          )}

          {mode === "login" && (
            <div className="text-right">
              <button type="button" onClick={() => { setMode("forgot"); setError(null); setNotice(null); }} className="text-xs text-neutral-400 hover:text-amber-300">
                Forgot password?
              </button>
            </div>
          )}

          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          {notice && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-amber-300 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-amber-200 disabled:opacity-50"
          >
            {busy ? "One moment…" : mode === "login" ? "Log in" : mode === "signup" ? "Create account" : mode === "forgot" ? "Send reset link" : "Update password"}
          </button>

          {mode === "forgot" && (
            <button type="button" onClick={() => { setMode("login"); setError(null); setNotice(null); }} className="w-full text-center text-xs text-neutral-400 hover:text-white">
              ← Back to log in
            </button>
          )}
        </form>

        <p className="mt-5 flex justify-center gap-3 text-center text-[11px] text-neutral-500">
          <a href="/landing" className="underline-offset-2 hover:text-neutral-300 hover:underline">Features &amp; Pricing</a>
          <span aria-hidden>·</span>
          <a href="/privacy" target="_blank" rel="noopener" className="underline-offset-2 hover:text-neutral-300 hover:underline">Privacy Policy</a>
        </p>
      </div>
    </div>
  );
}
