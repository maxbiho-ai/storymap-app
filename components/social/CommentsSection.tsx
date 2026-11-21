"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { useMapStore } from "@/store/mapStore";
import { useSocialStore } from "@/store/socialStore";
import { PinIcon } from "./icons";

export interface PhotoComment {
  id: string;
  photo_id: string;
  user_id: string;
  author_name: string | null;
  parent_id: string | null;
  body: string;
  is_question: boolean;
  is_pinned_tip: boolean;
  created_at: string;
}

export function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString();
}

interface Props {
  photoId: string;
  /** Photo owner: may pin / unpin creator tips and delete any comment */
  ownerId: string;
  /** Focus the composer on open (notification → reply right away) */
  autoFocus?: boolean;
  /** Taller list in the lightbox side panel */
  tall?: boolean;
}

/**
 * Comments & questions on one photo. Pinned creator tips first, then threads (newest last),
 * replies one level deep. Writes go through RLS (migration 006); the DB triggers fill author_name
 * and notify the photo owner / the thread's author.
 */
export default function CommentsSection({ photoId, ownerId, autoFocus, tall }: Props) {
  const me = useMapStore((s) => s.currentUserId);
  const requestLogin = useMapStore((s) => s.requestLogin);
  const setCommentCount = useSocialStore((s) => s.setCommentCount);
  const [comments, setComments] = useState<PhotoComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const isOwner = Boolean(me && me === ownerId);

  const load = useCallback(async () => {
    const { data, error } = await getSupabase()
      .from("photo_comments")
      .select("*")
      .eq("photo_id", photoId)
      .order("created_at", { ascending: true })
      .limit(500);
    setLoading(false);
    if (error) return setError(error.code === "42P01" ? "Comments aren't set up yet (run migration 006)." : error.message);
    setError(null);
    setComments((data ?? []) as PhotoComment[]);
    setCommentCount(photoId, data?.length ?? 0);
  }, [photoId, setCommentCount]);

  useEffect(() => {
    setLoading(true);
    setComments([]);
    setReplyTo(null);
    void load();
  }, [load]);

  const { tips, threads, replies } = useMemo(() => {
    const top = comments.filter((c) => !c.parent_id);
    const rep = new Map<string, PhotoComment[]>();
    for (const c of comments) if (c.parent_id) rep.set(c.parent_id, [...(rep.get(c.parent_id) ?? []), c]);
    // Pinned replies show as tips too
    return { tips: comments.filter((c) => c.is_pinned_tip), threads: top, replies: rep };
  }, [comments]);

  const post = async (body: string, isQuestion: boolean, parentId: string | null): Promise<boolean> => {
    if (!me) {
      requestLogin();
      return false;
    }
    const { data, error } = await getSupabase()
      .from("photo_comments")
      .insert({ photo_id: photoId, user_id: me, body: body.trim(), is_question: isQuestion, parent_id: parentId })
      .select("*")
      .single();
    if (error || !data) {
      setError(error?.message ?? "Could not post");
      return false;
    }
    setComments((cs) => {
      const next = [...cs, data as PhotoComment];
      setCommentCount(photoId, next.length);
      return next;
    });
    setReplyTo(null);
    return true;
  };

  const togglePin = async (c: PhotoComment) => {
    setComments((cs) => cs.map((x) => (x.id === c.id ? { ...x, is_pinned_tip: !c.is_pinned_tip } : x)));
    const { error } = await getSupabase().from("photo_comments").update({ is_pinned_tip: !c.is_pinned_tip }).eq("id", c.id);
    if (error) {
      setError(error.message);
      setComments((cs) => cs.map((x) => (x.id === c.id ? c : x)));
    }
  };

  const remove = async (c: PhotoComment) => {
    if (!window.confirm("Delete this comment?")) return;
    const { error } = await getSupabase().from("photo_comments").delete().eq("id", c.id);
    if (error) return setError(error.message);
    setComments((cs) => {
      const next = cs.filter((x) => x.id !== c.id && x.parent_id !== c.id);
      setCommentCount(photoId, next.length);
      return next;
    });
  };

  const row = (c: PhotoComment, opts: { reply?: boolean; inTips?: boolean } = {}) => (
    <CommentRow
      key={`${opts.inTips ? "tip-" : ""}${c.id}`}
      c={c}
      reply={opts.reply}
      inTips={opts.inTips}
      byOwner={c.user_id === ownerId}
      canPin={isOwner}
      canDelete={Boolean(me && (me === c.user_id || isOwner))}
      onReply={opts.inTips ? undefined : () => (me ? setReplyTo(c.parent_id ?? c.id) : requestLogin())}
      onPin={() => void togglePin(c)}
      onDelete={() => void remove(c)}
    />
  );

  return (
    <div className="space-y-2 text-sm">
      {tips.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-amber-300/30 bg-amber-300/5 p-2">
          <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-300">
            <PinIcon /> Creator tips
          </p>
          {tips.map((c) => row(c, { inTips: true }))}
        </div>
      )}

      <div className={`space-y-2 overflow-y-auto pr-1 ${tall ? "max-h-[55vh]" : "max-h-64"}`}>
        {loading && <p className="text-xs text-neutral-500">Loading…</p>}
        {!loading && !threads.length && !error && (
          <p className="text-xs text-neutral-500">No comments yet. Ask the photographer how to get there, the best time to shoot…</p>
        )}
        {threads.map((t) => (
          <div key={t.id} className="space-y-1.5">
            {row(t)}
            {(replies.get(t.id) ?? []).map((r) => row(r, { reply: true }))}
            {replyTo === t.id && (
              <div className="ms-6">
                <Composer autoFocus placeholder={`Reply to ${t.author_name ?? "comment"}…`} onSubmit={(b) => post(b, false, t.id)} onCancel={() => setReplyTo(null)} />
              </div>
            )}
          </div>
        ))}
      </div>

      {error && <p className="rounded-lg bg-red-950/60 px-2 py-1 text-[11px] text-red-200">{error}</p>}

      {me ? (
        <Composer allowQuestion autoFocus={autoFocus} placeholder={isOwner ? "Add a note or answer…" : "Write a comment…"} onSubmit={(b, q) => post(b, q, null)} />
      ) : (
        <button type="button" onClick={requestLogin} className="w-full rounded-lg border border-white/10 px-3 py-1.5 text-xs text-neutral-300 hover:bg-white/5">
          Log in to comment or ask a question
        </button>
      )}
    </div>
  );
}

function CommentRow({
  c, reply, inTips, byOwner, canPin, canDelete, onReply, onPin, onDelete,
}: {
  c: PhotoComment;
  reply?: boolean;
  inTips?: boolean;
  byOwner: boolean;
  canPin: boolean;
  canDelete: boolean;
  onReply?: () => void;
  onPin: () => void;
  onDelete: () => void;
}) {
  const link = "text-[11px] text-neutral-500 hover:text-white";
  return (
    <div className={`rounded-lg px-2 py-1.5 ${reply ? "ms-6 bg-white/[0.03]" : inTips ? "" : "bg-white/5"}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className="font-semibold text-neutral-200" dir="auto">{c.author_name ?? "Someone"}</span>
        {byOwner && <span className="rounded bg-amber-300/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-300">Creator</span>}
        {c.is_question && <span className="rounded bg-sky-400/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-sky-300">Question</span>}
        {c.is_pinned_tip && !inTips && <span className="rounded bg-amber-300/15 px-1 text-[9px] font-semibold uppercase tracking-wide text-amber-300">Pinned tip</span>}
        <span className="text-neutral-500">{timeAgo(c.created_at)}</span>
      </div>
      <p className="mt-0.5 whitespace-pre-line break-words text-[13px] leading-snug text-neutral-200" dir="auto">{c.body}</p>
      <div className="mt-0.5 flex gap-3">
        {onReply && <button type="button" onClick={onReply} className={link}>Reply</button>}
        {canPin && (
          <button type="button" onClick={onPin} className={`${link} ${c.is_pinned_tip ? "!text-amber-300" : ""}`}>
            {c.is_pinned_tip ? "Unpin tip" : "Pin as tip"}
          </button>
        )}
        {canDelete && !inTips && <button type="button" onClick={onDelete} className={`${link} hover:!text-red-300`}>Delete</button>}
      </div>
    </div>
  );
}

function Composer({
  onSubmit, onCancel, placeholder, allowQuestion, autoFocus,
}: {
  onSubmit: (body: string, isQuestion: boolean) => Promise<boolean>;
  onCancel?: () => void;
  placeholder: string;
  allowQuestion?: boolean;
  autoFocus?: boolean;
}) {
  const [body, setBody] = useState("");
  const [question, setQuestion] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (autoFocus) ref.current?.focus({ preventScroll: false });
  }, [autoFocus]);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    const ok = await onSubmit(body, question);
    setBusy(false);
    if (ok) {
      setBody("");
      setQuestion(false);
    }
  };

  return (
    <div className="rounded-xl border border-white/10 bg-neutral-900 p-1.5">
      <textarea
        ref={ref}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation(); // the map / lightbox shortcuts must not fire while typing
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit();
          if (e.key === "Escape") onCancel?.();
        }}
        rows={2}
        maxLength={2000}
        dir="auto"
        placeholder={placeholder}
        className="w-full resize-none bg-transparent px-1 text-[13px] text-white outline-none placeholder:text-neutral-500"
      />
      <div className="flex items-center gap-2">
        {allowQuestion && (
          <button
            type="button"
            onClick={() => setQuestion((q) => !q)}
            aria-pressed={question}
            className={`rounded-full border px-2 py-0.5 text-[11px] transition ${question ? "border-sky-400 bg-sky-400/15 text-sky-300" : "border-white/15 text-neutral-400 hover:text-white"}`}
          >
            ? Mark as question
          </button>
        )}
        <span className="flex-1" />
        {onCancel && <button type="button" onClick={onCancel} className="text-[11px] text-neutral-400 hover:text-white">Cancel</button>}
        <button
          type="button"
          onClick={() => void submit()}
          disabled={!body.trim() || busy}
          className="rounded-lg bg-amber-300 px-3 py-1 text-xs font-semibold text-neutral-900 hover:bg-amber-200 disabled:opacity-40"
        >
          {busy ? "…" : "Post"}
        </button>
      </div>
    </div>
  );
}
