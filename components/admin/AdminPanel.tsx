"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { getSupabase } from "@/lib/supabase/client";
import { isUnlimited } from "@/lib/beta";

interface AccessRequest { id: string; user_id: string; email: string; full_name: string | null; message: string | null; created_at: string }
interface Creator { id: string; email: string; full_name: string | null; username: string; is_admin: boolean; can_upload: boolean; photo_quota: number | null; photo_count: number }
interface InviteCode { code: string; max_uses: number | null; used_count: number; quota_granted: number | null; expires_at: string | null }
interface Report { id: string; photo_id: string; reason: string | null; created_at: string; photo?: { thumb_url: string | null; photo_url: string; location_name: string | null; title: string | null; is_private: boolean } }

const input = "rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-neutral-100 outline-none focus:border-amber-300/70";
const btn = "rounded-lg px-2.5 py-1 text-xs font-semibold transition disabled:opacity-40";

const newCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return `BETA-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("")}`;
};

function Section({ title, count, children }: { title: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        {title}
        {count != null && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-medium text-neutral-300">{count}</span>}
      </h3>
      {children}
    </section>
  );
}

/** Admin moderation: access requests, beta creators + quotas, invite codes, reported photos. RLS + RPC checks enforce is_admin server-side. */
export default function AdminPanel({ onClose }: { onClose: () => void }) {
  const db = getSupabase();
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [creators, setCreators] = useState<Creator[]>([]);
  const [codes, setCodes] = useState<InviteCode[]>([]);
  const [reports, setReports] = useState<Report[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const [r, c, i, rep] = await Promise.all([
      db.from("access_requests").select("id, user_id, email, full_name, message, created_at").eq("status", "pending").order("created_at"),
      db.rpc("admin_list_creators"),
      db.from("invite_codes").select("code, max_uses, used_count, quota_granted, expires_at").order("created_at", { ascending: false }),
      db.from("photo_reports").select("id, photo_id, reason, created_at").eq("status", "open").order("created_at"),
    ]);
    const firstErr = r.error ?? c.error ?? i.error ?? rep.error;
    if (firstErr) setError(firstErr.message);
    setRequests((r.data ?? []) as AccessRequest[]);
    setCreators(((c.data ?? []) as Creator[]).map((x) => ({ ...x, photo_count: Number(x.photo_count) })));
    setCodes((i.data ?? []) as InviteCode[]);

    const reportRows = (rep.data ?? []) as Report[];
    if (reportRows.length) {
      const { data: photos } = await db.from("photos").select("id, thumb_url, photo_url, location_name, title, is_private").in("id", [...new Set(reportRows.map((x) => x.photo_id))]);
      const byId = new Map((photos ?? []).map((p) => [p.id as string, p]));
      for (const x of reportRows) x.photo = byId.get(x.photo_id) as Report["photo"];
    }
    setReports(reportRows);
    setLoading(false);
  }, [db]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Runs one admin action, then reloads everything */
  const act = async (key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(key);
    setError(null);
    const { error: err } = await fn();
    if (err) setError(err.message);
    await load();
    setBusy(null);
  };

  const approve = (id: string, quota: number) => act(`req-${id}`, () => db.rpc("admin_approve_request", { p_id: id, p_quota: quota }));
  const dismiss = (id: string) => act(`req-${id}`, () => db.from("access_requests").update({ status: "dismissed" }).eq("id", id));

  const [quotaDraft, setQuotaDraft] = useState<Record<string, string>>({});
  const saveQuota = (c: Creator, unlimited: boolean, raw?: string) => {
    const n = Math.floor(Number(raw ?? quotaDraft[c.id] ?? c.photo_quota ?? 0));
    if (!unlimited && (!Number.isFinite(n) || n < 0)) return setError("Quota must be a number from 0");
    return act(`cr-${c.id}`, () => db.from("profiles").update({ photo_quota: unlimited ? null : n }).eq("id", c.id));
  };
  const toggleUpload = (c: Creator) => act(`cr-${c.id}`, () => db.from("profiles").update({ can_upload: !c.can_upload }).eq("id", c.id));

  const [code, setCode] = useState(newCode);
  const [codeQuota, setCodeQuota] = useState("15");
  const [codeUnlimited, setCodeUnlimited] = useState(false);
  const [codeUses, setCodeUses] = useState("10");
  const createCode = (e: FormEvent) => {
    e.preventDefault();
    const quota = codeUnlimited ? null : Math.floor(Number(codeQuota));
    const uses = Math.floor(Number(codeUses));
    if (code.trim().length < 4) return setError("Code must be at least 4 characters");
    if (!codeUnlimited && (!Number.isFinite(quota) || (quota as number) < 0)) return setError("Quota must be a number from 0");
    if (!Number.isFinite(uses) || uses < 1) return setError("Max uses must be at least 1");
    void act("new-code", () => db.from("invite_codes").insert({ code: code.trim().toUpperCase(), quota_granted: quota, max_uses: uses })).then(() => setCode(newCode()));
  };

  const hide = (r: Report) =>
    act(`rep-${r.id}`, async () => {
      const a = await db.from("photos").update({ is_private: true }).eq("id", r.photo_id);
      if (a.error) return a;
      return db.from("photo_reports").update({ status: "hidden" }).eq("photo_id", r.photo_id).eq("status", "open");
    });
  const dismissReport = (r: Report) => act(`rep-${r.id}`, () => db.from("photo_reports").update({ status: "dismissed" }).eq("id", r.id));

  return createPortal(
    <div className="fixed inset-0 z-[120] flex justify-end bg-black/60" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <aside role="dialog" aria-modal="true" aria-label="Admin panel" className="h-full w-full max-w-2xl space-y-6 overflow-y-auto bg-neutral-950 p-5 text-neutral-100 shadow-2xl ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Admin panel</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-neutral-500 hover:text-white">×</button>
        </div>
        {error && <p className="rounded-lg bg-red-950/80 px-3 py-2 text-xs text-red-200">{error}</p>}
        {loading && <p className="text-sm text-neutral-400">Loading…</p>}

        <Section title="Pending access requests" count={requests.length}>
          {!requests.length && !loading && <p className="text-xs text-neutral-500">No pending requests.</p>}
          {requests.map((r) => (
            <div key={r.id} className="rounded-xl bg-white/5 p-3 text-xs">
              <p className="font-semibold">{r.full_name || "(no name)"} <span className="font-normal text-neutral-400">{r.email}</span></p>
              {r.message && <p className="mt-1 whitespace-pre-line text-neutral-300">{r.message}</p>}
              <p className="mt-1 text-[10px] text-neutral-500">{new Date(r.created_at).toLocaleString()}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <button type="button" disabled={busy === `req-${r.id}`} onClick={() => approve(r.id, 15)} className={`${btn} bg-amber-300 text-neutral-900 hover:bg-amber-200`}>Approve (15)</button>
                <button type="button" disabled={busy === `req-${r.id}`} onClick={() => approve(r.id, 100)} className={`${btn} bg-sky-300 text-neutral-900 hover:bg-sky-200`}>Approve VIP (100)</button>
                <button type="button" disabled={busy === `req-${r.id}`} onClick={() => dismiss(r.id)} className={`${btn} bg-white/10 hover:bg-white/15`}>Dismiss</button>
              </div>
            </div>
          ))}
        </Section>

        <Section title="Reported photos" count={reports.length}>
          {!reports.length && !loading && <p className="text-xs text-neutral-500">Nothing reported.</p>}
          {reports.map((r) => (
            <div key={r.id} className="flex items-center gap-3 rounded-xl bg-white/5 p-2 text-xs">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {r.photo && <img src={r.photo.thumb_url ?? r.photo.photo_url} alt="" className="h-14 w-14 shrink-0 rounded-lg object-cover" />}
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold" dir="auto">{r.photo?.location_name ?? r.photo?.title ?? "Photo"}</p>
                <p className="truncate text-neutral-400">{r.reason || "(no reason)"}</p>
              </div>
              <button type="button" disabled={busy === `rep-${r.id}`} onClick={() => hide(r)} className={`${btn} bg-red-400 text-neutral-950 hover:bg-red-300`}>Hide</button>
              <button type="button" disabled={busy === `rep-${r.id}`} onClick={() => dismissReport(r)} className={`${btn} bg-white/10 hover:bg-white/15`}>Dismiss</button>
            </div>
          ))}
        </Section>

        <Section title="Beta creators & quotas" count={creators.filter((c) => c.can_upload).length}>
          <div className="overflow-x-auto rounded-xl bg-white/5">
            <table className="w-full min-w-[34rem] text-left text-xs">
              <thead className="text-[10px] uppercase tracking-wide text-neutral-500">
                <tr><th className="p-2">User</th><th className="p-2">Photos</th><th className="p-2">Can upload</th><th className="p-2">Quota</th></tr>
              </thead>
              <tbody>
                {creators.map((c) => {
                  const unlimited = isUnlimited(c.photo_quota);
                  return (
                    <tr key={c.id} className="border-t border-white/5 align-middle">
                      <td className="max-w-[12rem] p-2">
                        <p className="truncate font-semibold">{c.full_name || c.username}{c.is_admin && <span className="ml-1 rounded bg-amber-300/20 px-1 text-[9px] text-amber-200">ADMIN</span>}</p>
                        <p className="truncate text-neutral-400">{c.email}</p>
                      </td>
                      <td className="p-2 tabular-nums">{c.photo_count}</td>
                      <td className="p-2">
                        <input type="checkbox" checked={c.can_upload || c.is_admin} disabled={c.is_admin || busy === `cr-${c.id}`} onChange={() => toggleUpload(c)} aria-label={`${c.email} can upload`} className="accent-amber-300" />
                      </td>
                      <td className="p-2">
                        {c.is_admin ? (
                          <span className="text-neutral-500">Unlimited</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <input
                              type="number"
                              min={0}
                              disabled={unlimited || busy === `cr-${c.id}`}
                              value={unlimited ? "" : quotaDraft[c.id] ?? String(c.photo_quota)}
                              placeholder="∞"
                              onChange={(e) => setQuotaDraft((d) => ({ ...d, [c.id]: e.target.value }))}
                              onKeyDown={(e) => e.key === "Enter" && saveQuota(c, false)}
                              className={`${input} w-16`}
                              aria-label={`${c.email} photo quota`}
                            />
                            <button type="button" disabled={unlimited || busy === `cr-${c.id}` || quotaDraft[c.id] == null} onClick={() => saveQuota(c, false)} className={`${btn} bg-white/10 hover:bg-white/15`}>Set</button>
                            <label className="flex items-center gap-1 text-neutral-300">
                              <input type="checkbox" checked={unlimited} disabled={busy === `cr-${c.id}`} onChange={(e) => saveQuota(c, e.target.checked, String(c.photo_quota ?? 15))} className="accent-amber-300" />
                              Unlimited
                            </label>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Invite codes" count={codes.length}>
          <form onSubmit={createCode} className="flex flex-wrap items-end gap-2 rounded-xl bg-white/5 p-3 text-xs">
            <label className="space-y-0.5">Code
              <span className="flex gap-1">
                <input value={code} onChange={(e) => setCode(e.target.value)} className={`${input} w-36 font-mono uppercase`} />
                <button type="button" onClick={() => setCode(newCode())} title="Random code" className={`${btn} bg-white/10 hover:bg-white/15`}>↻</button>
              </span>
            </label>
            <label className="space-y-0.5">Photos each
              <input type="number" min={0} value={codeUnlimited ? "" : codeQuota} disabled={codeUnlimited} placeholder="∞" onChange={(e) => setCodeQuota(e.target.value)} className={`${input} block w-20`} />
            </label>
            <label className="flex items-center gap-1 pb-1 text-neutral-300"><input type="checkbox" checked={codeUnlimited} onChange={(e) => setCodeUnlimited(e.target.checked)} className="accent-amber-300" /> Unlimited</label>
            <label className="space-y-0.5">Max uses
              <input type="number" min={1} value={codeUses} onChange={(e) => setCodeUses(e.target.value)} className={`${input} block w-20`} />
            </label>
            <button type="submit" disabled={busy === "new-code"} className={`${btn} bg-amber-300 text-neutral-900 hover:bg-amber-200`}>Create</button>
          </form>
          {codes.map((c) => (
            <div key={c.code} className="flex items-center gap-3 rounded-xl bg-white/5 px-3 py-2 text-xs">
              <button type="button" title="Copy" onClick={() => void navigator.clipboard?.writeText(c.code)} className="font-mono font-semibold tracking-wide hover:text-amber-300">{c.code}</button>
              <span className="text-neutral-400">{isUnlimited(c.quota_granted) ? "unlimited" : `${c.quota_granted} photos`}</span>
              <span className="text-neutral-400">{c.used_count}/{c.max_uses ?? "∞"} used</span>
              {c.max_uses != null && c.used_count >= c.max_uses && <span className="text-red-300">used up</span>}
              <button type="button" disabled={busy === `code-${c.code}`} onClick={() => act(`code-${c.code}`, () => db.from("invite_codes").delete().eq("code", c.code))} className={`${btn} ml-auto bg-white/10 hover:bg-white/15`}>Delete</button>
            </div>
          ))}
        </Section>
      </aside>
    </div>,
    document.body,
  );
}
