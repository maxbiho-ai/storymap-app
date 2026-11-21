"use client";

import { useEffect, useState } from "react";
import { useMapStore } from "@/store/mapStore";
import { useSocialStore } from "@/store/socialStore";
import { BookmarkIcon, CommentIcon, HeartIcon, TrashIcon } from "./icons";

interface Props {
  photoId: string;
  commentsOpen: boolean;
  onToggleComments: () => void;
  /** Owner only: opens the delete dialog */
  onDelete?: () => void;
  /** "card" = inside the dark card; "overlay" = on top of the full-screen photo */
  tone?: "card" | "overlay";
}

/** ♥ like · 🔖 save to lists · 💬 comments · 🗑 delete (owner) — with the save panel in-flow below */
export default function SocialActions({ photoId, commentsOpen, onToggleComments, onDelete, tone = "card" }: Props) {
  const me = useMapStore((s) => s.currentUserId);
  const requestLogin = useMapStore((s) => s.requestLogin);
  const like = useSocialStore((s) => s.likes[photoId]);
  const loadLikes = useSocialStore((s) => s.loadLikes);
  const toggleLike = useSocialStore((s) => s.toggleLike);
  const saved = useSocialStore((s) => s.saved[photoId]);
  const loadSaved = useSocialStore((s) => s.loadSaved);
  const comments = useSocialStore((s) => s.commentCounts[photoId]);
  const loadCommentCount = useSocialStore((s) => s.loadCommentCount);
  const [saveOpen, setSaveOpen] = useState(false);

  useEffect(() => {
    void loadLikes(photoId);
    void loadCommentCount(photoId);
    if (me) void loadSaved(photoId);
    setSaveOpen(false);
  }, [photoId, me, loadLikes, loadSaved, loadCommentCount]);

  const pill =
    tone === "overlay"
      ? "flex h-9 items-center gap-1.5 rounded-full bg-black/55 px-3 text-sm text-white backdrop-blur transition hover:bg-black/80"
      : "flex h-8 items-center gap-1.5 rounded-full px-2.5 text-xs text-neutral-300 transition hover:bg-white/10 hover:text-white";
  const isSaved = Boolean(saved?.length);

  return (
    <div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => void toggleLike(photoId)}
          aria-pressed={like?.liked ?? false}
          aria-label={like?.liked ? "Unlike" : "Like"}
          title={like?.liked ? "Unlike" : "Like"}
          className={`${pill} ${like?.liked ? "!text-rose-400" : ""}`}
        >
          <span className={like?.liked ? "animate-[pop_.25s_ease-out]" : ""}>
            <HeartIcon filled={like?.liked} />
          </span>
          <span className="tabular-nums">{like?.count ?? 0}</span>
        </button>

        <button
          type="button"
          onClick={() => (me ? setSaveOpen((o) => !o) : requestLogin())}
          aria-expanded={saveOpen}
          aria-label="Save to a list"
          title="Save to Favorites or a trip list"
          className={`${pill} ${isSaved ? "!text-amber-300" : ""}`}
        >
          <BookmarkIcon filled={isSaved} />
          <span>{isSaved ? "Saved" : "Save"}</span>
        </button>

        <button
          type="button"
          onClick={onToggleComments}
          aria-expanded={commentsOpen}
          title="Comments & questions"
          className={`${pill} ${commentsOpen ? "!text-sky-300" : ""}`}
        >
          <CommentIcon />
          <span className="tabular-nums">{comments ?? 0}</span>
        </button>

        {onDelete && (
          <button type="button" onClick={onDelete} aria-label="Delete" title="Delete (owner)" className={`${pill} ml-auto hover:!text-red-300`}>
            <TrashIcon size={15} />
          </button>
        )}
      </div>
      {saveOpen && me && <SavePanel photoId={photoId} onClose={() => setSaveOpen(false)} tone={tone} />}
    </div>
  );
}

/** Toggle the photo in Favorites / any trip list, or create a new list on the spot */
export function SavePanel({ photoId, onClose, tone = "card" }: { photoId: string; onClose: () => void; tone?: "card" | "overlay" }) {
  const collections = useSocialStore((s) => s.collections);
  const loadCollections = useSocialStore((s) => s.loadCollections);
  const saved = useSocialStore((s) => s.saved[photoId]) ?? [];
  const toggleSaved = useSocialStore((s) => s.toggleSaved);
  const createCollection = useSocialStore((s) => s.createCollection);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!collections.length) void loadCollections();
  }, [collections.length, loadCollections]);

  const create = async () => {
    if (!name.trim() || busy) return;
    setBusy(true);
    const c = await createCollection(name);
    setBusy(false);
    if (c) {
      setName("");
      await toggleSaved(photoId, c.id);
    }
  };

  return (
    <div
      className={`mt-2 rounded-xl border border-white/10 p-2 text-sm text-neutral-100 shadow-xl ${tone === "overlay" ? "bg-neutral-950/95 backdrop-blur" : "bg-neutral-900"}`}
      onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), onClose())}
    >
      <div className="mb-1 flex items-center justify-between px-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Save to</span>
        <button type="button" onClick={onClose} aria-label="Close" className="text-base leading-none text-neutral-500 hover:text-white">×</button>
      </div>
      <ul className="max-h-48 overflow-y-auto">
        {collections.map((c) => {
          const on = saved.includes(c.id);
          return (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => void toggleSaved(photoId, c.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-start hover:bg-white/5"
              >
                <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${on ? "border-amber-300 bg-amber-300 text-neutral-900" : "border-white/30"}`}>
                  {on && "✓"}
                </span>
                <span className="min-w-0 flex-1 truncate" dir="auto">
                  {c.is_default_favorites ? "★ Favorites" : c.name}
                </span>
                <span className="text-[11px] tabular-nums text-neutral-500">{c.item_count}</span>
              </button>
            </li>
          );
        })}
        {!collections.length && <li className="px-2 py-1.5 text-xs text-neutral-500">Loading lists…</li>}
      </ul>
      <form
        className="mt-1 flex gap-1 border-t border-white/10 pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="+ New list (e.g. טיול לגרמניה)"
          maxLength={80}
          dir="auto"
          aria-label="New list name"
          className="min-w-0 flex-1 rounded-lg border border-white/10 bg-neutral-950 px-2 py-1 text-xs text-white outline-none placeholder:text-neutral-500 focus:border-amber-300"
        />
        <button type="submit" disabled={!name.trim() || busy} className="rounded-lg bg-amber-300 px-2.5 py-1 text-xs font-semibold text-neutral-900 disabled:opacity-40">
          {busy ? "…" : "Add"}
        </button>
      </form>
    </div>
  );
}
