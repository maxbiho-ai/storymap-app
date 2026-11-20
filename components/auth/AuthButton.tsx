"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";

interface Props {
  user: User | null;
  loading: boolean;
  onLogin: () => void;
  onSignOut: () => void;
}

/** בסרגל העליון: "התחברות" למשתמש אורח, או עיגול עם האות הראשונה + תפריט התנתקות */
export default function AuthButton({ user, loading, onLogin, onSignOut }: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setMenuOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [menuOpen]);

  if (loading) return <div className="h-11 w-11 shrink-0 animate-pulse rounded-2xl bg-neutral-950/80" />;

  if (!user) {
    return (
      <button
        type="button"
        onClick={onLogin}
        className="flex h-11 shrink-0 items-center gap-2 rounded-2xl bg-neutral-950/80 px-4 text-sm font-medium text-white shadow-lg backdrop-blur hover:bg-neutral-900"
      >
        <svg viewBox="0 0 20 20" className="h-4 w-4 fill-current" aria-hidden>
          <path d="M10 10a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0H3z" />
        </svg>
        <span className="hidden sm:inline">Log in</span>
      </button>
    );
  }

  const name = (user.user_metadata?.full_name as string | undefined) || user.email || "";
  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setMenuOpen((o) => !o)}
        aria-label="Account"
        aria-expanded={menuOpen}
        className="flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-950/80 text-base font-bold uppercase text-amber-300 shadow-lg backdrop-blur hover:bg-neutral-900"
      >
        {name.charAt(0) || "?"}
      </button>
      {menuOpen && (
        <div className="absolute end-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 text-sm text-neutral-100 shadow-2xl">
          <div className="border-b border-white/10 px-4 py-3">
            {user.user_metadata?.full_name && <p className="font-medium">{user.user_metadata.full_name as string}</p>}
            <p className="truncate text-xs text-neutral-400">{user.email}</p>
          </div>
          <button
            type="button"
            onClick={() => { setMenuOpen(false); onSignOut(); }}
            className="w-full px-4 py-2.5 text-start text-red-300 hover:bg-white/5"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
