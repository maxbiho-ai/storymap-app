"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";

/**
 * המשתמש המחובר, מתעדכן אוטומטית בהתחברות / התנתקות / רענון טוקן.
 * `recovery` = חזרה מקישור "שכחתי סיסמה": צריך להציג חלון סיסמה חדשה.
 */
export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovery, setRecovery] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    supabase.auth.getSession().then(({ data }) => {
      setUser(data.session?.user ?? null);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      setUser(session?.user ?? null);
      if (event === "PASSWORD_RECOVERY") setRecovery(true);
      if (event === "SIGNED_OUT") setRecovery(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  return { user, loading, recovery, endRecovery: () => setRecovery(false), signOut: () => getSupabase().auth.signOut() };
}
