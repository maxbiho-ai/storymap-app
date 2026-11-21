"use client";

import { useEffect, useRef, useState } from "react";
import { useMapStore } from "@/store/mapStore";
import { useSocialStore } from "@/store/socialStore";
import { RouteIcon } from "./icons";

/** Header: pick one of my saved lists (Favorites / trip lists) to show on the map as a route */
export default function ListsMenu() {
  const me = useMapStore((s) => s.currentUserId);
  const active = useMapStore((s) => s.activeCollection);
  const setActive = useMapStore((s) => s.setActiveCollection);
  const collections = useSocialStore((s) => s.collections);
  const loadCollections = useSocialStore((s) => s.loadCollections);
  const deleteCollection = useSocialStore((s) => s.deleteCollection);
  const createCollection = useSocialStore((s) => s.createCollection);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (me) void loadCollections();
  }, [me, loadCollections]);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!me) return null;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="My lists"
        title="Show a saved list on the map"
        className={`flex h-11 items-center gap-2 rounded-2xl px-3 text-sm font-medium shadow-lg backdrop-blur ${
          active ? "bg-amber-300 text-neutral-900 hover:bg-amber-200" : "bg-neutral-950/80 text-white hover:bg-neutral-900"
        }`}
      >
        <RouteIcon />
        <span className="hidden max-w-[9rem] truncate lg:inline" dir="auto">{active ? active.name : "Lists"}</span>
      </button>
      {open && (
        <div className="absolute end-0 top-full z-50 mt-2 w-72 overflow-hidden rounded-2xl border border-white/10 bg-neutral-950 text-sm text-neutral-100 shadow-2xl">
          <p className="px-4 pb-1 pt-3 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">Show on map as a trip</p>
          <ul className="max-h-72 overflow-y-auto py-1">
            {collections.map((c) => (
              <li key={c.id} className="group flex items-center">
                <button
                  type="button"
                  onClick={() => {
                    setActive(active?.id === c.id ? null : { id: c.id, name: c.is_default_favorites ? "Favorites" : c.name });
                    setOpen(false);
                  }}
                  className={`flex min-w-0 flex-1 items-center gap-2 px-4 py-2 text-start hover:bg-white/5 ${active?.id === c.id ? "text-amber-300" : ""}`}
                >
                  <span className="min-w-0 flex-1 truncate" dir="auto">{c.is_default_favorites ? "★ Favorites" : c.name}</span>
                  <span className="text-xs tabular-nums text-neutral-500">{c.item_count}</span>
                </button>
                {!c.is_default_favorites && (
                  <button
                    type="button"
                    onClick={() => window.confirm(`Delete the list "${c.name}"? The photos stay on the map.`) && void deleteCollection(c.id)}
                    aria-label={`Delete list ${c.name}`}
                    className="px-3 py-2 text-neutral-600 opacity-0 hover:text-red-300 group-hover:opacity-100 focus:opacity-100"
                  >
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <form
            className="flex gap-1 border-t border-white/10 p-2"
            onSubmit={async (e) => {
              e.preventDefault();
              if (await createCollection(name)) setName("");
            }}
          >
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="+ New trip list"
              maxLength={80}
              dir="auto"
              aria-label="New list name"
              className="min-w-0 flex-1 rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-xs outline-none placeholder:text-neutral-500 focus:border-amber-300"
            />
            <button type="submit" disabled={!name.trim()} className="rounded-lg bg-amber-300 px-2.5 py-1 text-xs font-semibold text-neutral-900 disabled:opacity-40">Add</button>
          </form>
          {active && (
            <button type="button" onClick={() => { setActive(null); setOpen(false); }} className="w-full border-t border-white/10 px-4 py-2.5 text-start text-xs text-neutral-300 hover:bg-white/5">
              Show the whole map again
            </button>
          )}
        </div>
      )}
    </div>
  );
}
