"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { getSupabase } from "@/lib/supabase/client";

type Mode = "login" | "signup";

/** Friendlier Supabase Auth error messages */
function translateError(msg: string): string {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "Wrong email or password";
  if (m.includes("email not confirmed")) return "Please confirm your email first: check your inbox";
  if (m.includes("already registered") || m.includes("already been registered")) return "An account with this email already exists. Try logging in";
  if (m.includes("password should be at least")) return "Password is too short: at least 6 characters";
  if (m.includes("rate limit") || m.includes("too many")) return "Too many attempts. Please try again in a few minutes";
  if (m.includes("invalid") && m.includes("email")) return "Invalid email address";
  return msg;
}

interface Props {
  open: boolean;
  onClose: () => void;
  initialMode?: Mode;
}

export default function AuthModal({ open, onClose, initialMode = "login" }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fullName, setFullName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMode(initialMode);
    setError(null);
    setNotice(null);
    setTimeout(() => emailRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, initialMode, onClose]);

  if (!open) return null;

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

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-title"
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 p-3 backdrop-blur-sm sm:items-center"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-3xl border border-white/10 bg-neutral-950 p-6 text-neutral-100 shadow-2xl">
        <div className="mb-5 flex items-start justify-between">
          <div>
            <p className="text-xs font-black tracking-[0.25em] text-white">
              STORY<span className="text-amber-300">MAP</span>
            </p>
            <h2 id="auth-title" className="mt-2 text-lg font-semibold">
              {mode === "login" ? "Log in" : "Create account"}
            </h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-neutral-500 hover:text-white">
            ×
          </button>
        </div>

        {/* מעבר בין התחברות להרשמה */}
        <div className="mb-5 grid grid-cols-2 rounded-xl bg-white/5 p-1 text-sm">
          {(["login", "signup"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => { setMode(m); setError(null); }}
              className={`rounded-lg py-1.5 font-medium transition ${mode === m ? "bg-white text-neutral-900" : "text-neutral-400 hover:text-white"}`}
            >
              {m === "login" ? "Log in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-3">
          {mode === "signup" && (
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} placeholder="Full name (shown as photographer)" autoComplete="name" className={input} />
          )}
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
          <input
            type="password"
            required
            minLength={6}
            dir="ltr"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={mode === "signup" ? "Password (at least 6 characters)" : "Password"}
            autoComplete={mode === "login" ? "current-password" : "new-password"}
            className={input}
          />

          {error && <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">{error}</p>}
          {notice && <p className="rounded-lg bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">{notice}</p>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-xl bg-amber-300 py-2.5 text-sm font-semibold text-neutral-900 transition hover:bg-amber-200 disabled:opacity-50"
          >
            {busy ? "One moment…" : mode === "login" ? "Log in" : "Create account"}
          </button>
        </form>
      </div>
    </div>
  );
}
