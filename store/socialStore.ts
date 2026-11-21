"use client";

import { create } from "zustand";
import { getSupabase } from "@/lib/supabase/client";
import { useMapStore } from "@/store/mapStore";

export interface Collection {
  id: string;
  name: string;
  is_default_favorites: boolean;
  created_at: string;
  item_count: number;
}

interface LikeState {
  count: number;
  liked: boolean;
}

/**
 * Likes and saved lists, shared by the card, the lightbox and the header,
 * so a like / save in one place shows everywhere at once (optimistic, rolled back on error).
 * Security is RLS (migration 006): users only write their own likes and lists.
 */
interface SocialState {
  likes: Record<string, LikeState>;
  loadLikes: (photoId: string) => Promise<void>;
  toggleLike: (photoId: string) => Promise<void>;

  collections: Collection[];
  loadCollections: () => Promise<void>;
  createCollection: (name: string) => Promise<Collection | null>;
  deleteCollection: (id: string) => Promise<void>;

  /** photoId → ids of my lists that contain it */
  saved: Record<string, string[]>;
  loadSaved: (photoId: string) => Promise<void>;
  toggleSaved: (photoId: string, collectionId: string) => Promise<void>;

  /** photoId → number of comments (incl. replies) */
  commentCounts: Record<string, number>;
  loadCommentCount: (photoId: string) => Promise<void>;
  setCommentCount: (photoId: string, n: number) => void;

  /** Bumped whenever list contents change (the trip-route view reloads) */
  version: number;
  error: string | null;
  reset: () => void;
}

const uid = () => useMapStore.getState().currentUserId;

export const useSocialStore = create<SocialState>((set, get) => ({
  likes: {},
  async loadLikes(photoId) {
    const db = getSupabase();
    const me = uid();
    const [countRes, mineRes] = await Promise.all([
      db.from("photo_likes").select("photo_id", { count: "exact", head: true }).eq("photo_id", photoId),
      me
        ? db.from("photo_likes").select("photo_id").eq("photo_id", photoId).eq("user_id", me).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);
    if ("error" in countRes && countRes.error) return; // table missing (migration not run): no counts
    set((s) => ({ likes: { ...s.likes, [photoId]: { count: countRes.count ?? 0, liked: Boolean(mineRes.data) } } }));
  },
  async toggleLike(photoId) {
    const me = uid();
    if (!me) return useMapStore.getState().requestLogin();
    const prev = get().likes[photoId] ?? { count: 0, liked: false };
    const next = { liked: !prev.liked, count: Math.max(0, prev.count + (prev.liked ? -1 : 1)) };
    set((s) => ({ likes: { ...s.likes, [photoId]: next } }));
    const db = getSupabase().from("photo_likes");
    const { error } = prev.liked
      ? await db.delete().eq("photo_id", photoId).eq("user_id", me)
      : await db.insert({ photo_id: photoId, user_id: me });
    if (error && error.code !== "23505") {
      set((s) => ({ likes: { ...s.likes, [photoId]: prev }, error: error.message }));
    }
  },

  collections: [],
  async loadCollections() {
    if (!uid()) return set({ collections: [] });
    const db = getSupabase();
    await db.rpc("ensure_favorites_list");
    const { data, error } = await db
      .from("user_collections")
      .select("id, name, is_default_favorites, created_at, collection_items(count)")
      .order("is_default_favorites", { ascending: false })
      .order("created_at", { ascending: true });
    if (error) return set({ error: error.message });
    set({
      collections: (data ?? []).map((c) => ({
        id: c.id as string,
        name: c.name as string,
        is_default_favorites: c.is_default_favorites as boolean,
        created_at: c.created_at as string,
        item_count: ((c.collection_items as { count: number }[] | null)?.[0]?.count ?? 0) as number,
      })),
    });
  },
  async createCollection(name) {
    const me = uid();
    const clean = name.trim().slice(0, 80);
    if (!me) {
      useMapStore.getState().requestLogin();
      return null;
    }
    if (!clean) return null;
    const { data, error } = await getSupabase()
      .from("user_collections")
      .insert({ user_id: me, name: clean })
      .select("id, name, is_default_favorites, created_at")
      .single();
    if (error || !data) {
      set({ error: error?.message ?? "Could not create the list" });
      return null;
    }
    const c: Collection = { ...(data as Omit<Collection, "item_count">), item_count: 0 };
    set((s) => ({ collections: [...s.collections, c] }));
    return c;
  },
  async deleteCollection(id) {
    const prev = get().collections;
    set({ collections: prev.filter((c) => c.id !== id) });
    const { error } = await getSupabase().from("user_collections").delete().eq("id", id);
    if (error) return set({ collections: prev, error: error.message });
    const active = useMapStore.getState().activeCollection;
    if (active?.id === id) useMapStore.getState().setActiveCollection(null);
    set((s) => ({
      version: s.version + 1,
      saved: Object.fromEntries(Object.entries(s.saved).map(([k, v]) => [k, v.filter((x) => x !== id)])),
    }));
  },

  saved: {},
  async loadSaved(photoId) {
    if (!uid()) return;
    const { data, error } = await getSupabase().from("collection_items").select("collection_id").eq("photo_id", photoId);
    if (error) return;
    set((s) => ({ saved: { ...s.saved, [photoId]: (data ?? []).map((r) => r.collection_id as string) } }));
  },
  async toggleSaved(photoId, collectionId) {
    if (!uid()) return useMapStore.getState().requestLogin();
    const prevSaved = get().saved[photoId] ?? [];
    const has = prevSaved.includes(collectionId);
    const bump = (d: number) => (s: SocialState) => ({
      collections: s.collections.map((c) => (c.id === collectionId ? { ...c, item_count: Math.max(0, c.item_count + d) } : c)),
    });
    set((s) => ({
      saved: { ...s.saved, [photoId]: has ? prevSaved.filter((x) => x !== collectionId) : [...prevSaved, collectionId] },
      ...bump(has ? -1 : 1)(s),
    }));
    const db = getSupabase().from("collection_items");
    const { error } = has
      ? await db.delete().eq("collection_id", collectionId).eq("photo_id", photoId)
      : await db.insert({ collection_id: collectionId, photo_id: photoId });
    if (error && error.code !== "23505") {
      set((s) => ({ saved: { ...s.saved, [photoId]: prevSaved }, ...bump(has ? 1 : -1)(s), error: error.message }));
      return;
    }
    set((s) => ({ version: s.version + 1 }));
  },

  commentCounts: {},
  async loadCommentCount(photoId) {
    const { count, error } = await getSupabase()
      .from("photo_comments")
      .select("id", { count: "exact", head: true })
      .eq("photo_id", photoId);
    if (!error) set((s) => ({ commentCounts: { ...s.commentCounts, [photoId]: count ?? 0 } }));
  },
  setCommentCount: (photoId, n) => set((s) => ({ commentCounts: { ...s.commentCounts, [photoId]: n } })),

  version: 0,
  error: null,
  reset: () => set({ collections: [], saved: {}, likes: {}, error: null }),
}));
