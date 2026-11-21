"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase/client";
import { useMapStore } from "@/store/mapStore";
import { BellIcon } from "./icons";
import { timeAgo } from "./CommentsSection";

export interface AppNotification {
  id: string;
  type: "comment" | "question" | "reply" | "like";
  actor_name: string | null;
  photo_id: string | null;
  comment_id: string | null;
  is_read: boolean;
  created_at: string;
  photo: { id: string; thumb_url: string | null; photo_url: string; location_name: string | null; title: string | null; latitude: number; longitude: number } | null;
  comment: { body: string } | null;
}

const VERB: Record<AppNotification["type"], string> = {
  comment: "commented on",
  question: "asked a question on",
  reply: "replied to you on",
  like: "liked",
};

interface Props {
  /** Fly to the pin and open its thread */
  onNavigate: (n: AppNotification) => void;
}

/**
 * Header bell: unread badge + recent activity on my photos and replies to my questions.
 * New rows arrive over Supabase Realtime (RLS: only mine); it also refreshes when the tab regains focus.
 */
export default function NotificationsBell({ onNavigate }: Props) {
  const me = useMapStore((s) => s.currentUserId);
  const [items, setItems] = useState<AppNotification[]>([]);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    if (!me) return setItems([]);
    const { data, error } = await getSupabase()
      .from("user_notifications")
      .select(
        "id, type, actor_name, photo_id, comment_id, is_read, created_at, " +
          "photo:photos(id, thumb_url, photo_url, location_name, title, latitude, longitude), comment:photo_comments(body)",
      )
      .eq("recipient_user_id", me)
      .order("created_at", { ascending: false })
      .limit(30);
    if (!error) setItems((data ?? []) as unknown as AppNotification[]);
  }, [me]);

  useEffect(() => {
    void load();
    if (!me) return;
    const db = getSupabase();
    const channel = db
      .channel(`notifications-${me}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "user_notifications", filter: `recipient_user_id=eq.${me}` },
        () => void load(),
      )
      .subscribe();
    const onFocus = () => document.visibilityState === "visible" && void load();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      void db.removeChannel(channel);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [me, load]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!me) return null;
  const unread = items.filter((n) => !n.is_read).length;

  const markRead = async (ids: string[]) => {
    if (!ids.length) return;
    setItems((xs) => xs.map((n) => (ids.includes(n.id) ? { ...n, is_read: true } : n)));
    await getSupabase().from("user_notifications").update({ is_read: true }).in("id", ids);
  };

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}
        aria-expanded={open}
        className="relative flex h-11 w-11 items-center justify-center rounded-2xl bg-neutral-950/80 text-white shadow-lg backdrop-blur hover:bg-neutral-900"
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold tabular-nums text-white ring-2 ring-neutral-950">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 text-sm text-neutral-100 shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
            <span className="font-semibold">Notifications</span>
            {unread > 0 && (
              <button type="button" onClick={() => void markRead(items.filter((n) => !n.is_read).map((n) => n.id))} className="text-xs text-neutral-400 hover:text-white">
                Mark all read
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {!items.length && <li className="px-4 py-6 text-center text-xs text-neutral-500">No activity yet. Comments and questions on your photos show up here.</li>}
            {items.map((n) => {
              const place = n.photo?.location_name ?? n.photo?.title ?? "your photo";
              return (
                <li key={n.id}>
                  <button
                    type="button"
                    onClick={() => {
                      void markRead([n.id]);
                      setOpen(false);
                      if (n.photo) onNavigate(n);
                    }}
                    className={`flex w-full gap-3 px-4 py-2.5 text-start hover:bg-white/5 ${n.is_read ? "opacity-60" : ""}`}
                  >
                    {n.photo ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={n.photo.thumb_url ?? n.photo.photo_url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="h-10 w-10 shrink-0 rounded-lg bg-white/5" />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block text-xs leading-snug">
                        <b dir="auto">{n.actor_name ?? "Someone"}</b> {VERB[n.type]} <span className="text-neutral-300" dir="auto">{place}</span>
                      </span>
                      {n.comment?.body && <span className="mt-0.5 line-clamp-2 block text-xs text-neutral-400" dir="auto">“{n.comment.body}”</span>}
                      <span className="mt-0.5 block text-[10px] text-neutral-500">{timeAgo(n.created_at)}</span>
                    </span>
                    {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-rose-500" aria-label="Unread" />}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
