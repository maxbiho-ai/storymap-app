"use client";

import { useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { useMapStore } from "@/store/mapStore";

const REASONS = ["Inappropriate content", "Not my place / spam", "Copyright", "Other"];

/** Discreet "Report" link on public photo cards: signed-in users flag a photo for the admin panel */
export default function ReportButton({ photoId }: { photoId: string }) {
  const currentUserId = useMapStore((s) => s.currentUserId);
  const requestLogin = useMapStore((s) => s.requestLogin);
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(REASONS[0]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  if (done) return <p className="pt-1 text-[11px] text-neutral-500">{done}</p>;

  const send = async () => {
    if (!currentUserId) return requestLogin();
    setBusy(true);
    const { error } = await getSupabase().from("photo_reports").insert({ photo_id: photoId, reporter_id: currentUserId, reason });
    setBusy(false);
    setDone(!error ? "Thanks, we will take a look." : error.code === "23505" ? "You already reported this photo." : "Could not send the report.");
  };

  if (!open) {
    return (
      <button type="button" onClick={() => (currentUserId ? setOpen(true) : requestLogin())} className="pt-1 text-[11px] text-neutral-600 hover:text-neutral-300">
        Report
      </button>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1 text-[11px]">
      <select value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Report reason" className="rounded-md bg-neutral-900 px-1.5 py-1 text-neutral-200 ring-1 ring-white/10">
        {REASONS.map((r) => <option key={r}>{r}</option>)}
      </select>
      <button type="button" onClick={send} disabled={busy} className="rounded-md bg-red-400/90 px-2 py-1 font-semibold text-neutral-950 hover:bg-red-300 disabled:opacity-50">
        {busy ? "Sending…" : "Report"}
      </button>
      <button type="button" onClick={() => setOpen(false)} className="text-neutral-500 hover:text-white">Cancel</button>
    </div>
  );
}
