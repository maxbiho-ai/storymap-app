"use client";

import { useEffect, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { hasPendingRequest, redeemInviteCode, submitAccessRequest } from "@/lib/beta";

interface Props {
  userId: string;
  email: string;
  fullName: string;
  onClose: () => void;
  /** Code redeemed: access is on, open the uploader */
  onUnlocked: () => void;
}

const field =
  "w-full rounded-lg border border-white/10 bg-neutral-900 px-3 py-2 text-sm text-neutral-100 outline-none placeholder:text-neutral-500 focus:border-amber-300/70";

/** Shown to a signed-in user without upload access: redeem an invite code, or request creator access */
export default function InviteGateModal({ userId, email, fullName, onClose, onUnlocked }: Props) {
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const [codeError, setCodeError] = useState<string | null>(null);

  const [name, setName] = useState(fullName);
  const [message, setMessage] = useState("");
  const [reqBusy, setReqBusy] = useState(false);
  const [reqError, setReqError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    let alive = true;
    void hasPendingRequest(userId).then((p) => alive && p && setSent(true));
    return () => {
      alive = false;
    };
  }, [userId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const redeem = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    setCodeBusy(true);
    setCodeError(null);
    const r = await redeemInviteCode(code);
    setCodeBusy(false);
    if (r.ok) onUnlocked();
    else setCodeError(r.error);
  };

  const request = async (e: FormEvent) => {
    e.preventDefault();
    setReqBusy(true);
    setReqError(null);
    try {
      await submitAccessRequest({ userId, email, fullName: name, message });
      setSent(true);
    } catch (err) {
      setReqError(err instanceof Error ? err.message : "Could not send the request");
    } finally {
      setReqBusy(false);
    }
  };

  return createPortal(
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/70 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="beta-title" className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-neutral-950 p-5 text-neutral-100 shadow-2xl ring-1 ring-white/10">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-amber-300">Invite-only beta</p>
            <h2 id="beta-title" className="text-lg font-semibold">Uploading is for approved creators</h2>
            <p className="mt-1 text-xs text-neutral-400">Browsing the map, filtering and trip planning stay free for everyone. Photo uploads are open to beta creators only.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="text-2xl leading-none text-neutral-500 hover:text-white">×</button>
        </div>

        <form onSubmit={redeem} className="space-y-2">
          <label htmlFor="invite-code" className="text-sm font-semibold">Have an invite code?</label>
          <div className="flex gap-2">
            <input
              id="invite-code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="BETA-XXXXXX"
              autoComplete="off"
              spellCheck={false}
              className={`${field} font-mono uppercase tracking-wider`}
            />
            <button type="submit" disabled={codeBusy || !code.trim()} className="shrink-0 rounded-lg bg-amber-300 px-4 py-2 text-sm font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-40">
              {codeBusy ? "Checking…" : "Redeem"}
            </button>
          </div>
          {codeError && <p className="text-xs text-red-300">{codeError}</p>}
        </form>

        <div className="my-4 flex items-center gap-3 text-[11px] uppercase tracking-wide text-neutral-500">
          <span className="h-px flex-1 bg-white/10" /> or <span className="h-px flex-1 bg-white/10" />
        </div>

        {sent ? (
          <p className="rounded-xl bg-emerald-400/10 px-3 py-3 text-sm text-emerald-200">
            ✓ Request sent. You can upload as soon as it is approved: come back and press Upload.
          </p>
        ) : (
          <form onSubmit={request} className="space-y-2">
            <p className="text-sm font-semibold">Request creator access</p>
            <input value={email} readOnly aria-label="Email" className={`${field} opacity-70`} />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" aria-label="Name" maxLength={80} className={field} />
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Optional: tell us what you shoot (max 500 characters)"
              aria-label="Message"
              maxLength={500}
              rows={3}
              className={`${field} resize-none`}
            />
            {reqError && <p className="text-xs text-red-300">{reqError}</p>}
            <button type="submit" disabled={reqBusy} className="w-full rounded-lg bg-white/10 px-4 py-2 text-sm font-semibold hover:bg-white/15 disabled:opacity-40">
              {reqBusy ? "Sending…" : "Send request"}
            </button>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
