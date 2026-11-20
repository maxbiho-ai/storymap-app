"use client";

import { useMemo, useRef, useState } from "react";
import { normalizeTag } from "@/lib/tags";
import { usePopularPhotographers, usePopularTags } from "@/hooks/usePhotoSearch";
import type { PhotoFilters } from "@/types/photo";

type Filters = Omit<PhotoFilters, "bounds">;

interface Props {
  value: Filters;
  onChange: (next: Filters) => void;
  resultCount?: number;
  loading?: boolean;
}

/**
 * Splits what's typed into the three filter kinds:
 *   "Frankfurt am Main #sunset @Max Bihovskiy"
 *   → text "Frankfurt am Main", tags ["sunset"], photographer "Max Bihovskiy"
 * Everything after "@" is the photographer (names contain spaces).
 */
export function parseSearch(draft: string): { text: string; tags: string[]; person: string | null; partialTag: string | null } {
  const at = draft.indexOf("@");
  const head = at >= 0 ? draft.slice(0, at) : draft;
  const person = at >= 0 ? draft.slice(at + 1).trim() : null;
  const words = head.split(/\s+/).filter(Boolean);
  const tags = words.filter((w) => w.startsWith("#")).map(normalizeTag).filter(Boolean);
  const text = words.filter((w) => !w.startsWith("#")).join(" ");
  const last = head.endsWith(" ") ? "" : (words[words.length - 1] ?? "");
  return { text, tags, person, partialTag: at < 0 && last.startsWith("#") ? normalizeTag(last) : null };
}

/** Search: plain text = location name, #tag, @photographer */
export default function PhotoSearchBar({ value, onChange, resultCount, loading }: Props) {
  const popularTags = usePopularTags();
  const photographers = usePopularPhotographers();
  const [draft, setDraft] = useState(value.query);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const parsed = parseSearch(draft);
  const mode: "person" | "tag" | "none" = parsed.person !== null ? "person" : parsed.partialTag !== null || !draft.trim() ? "tag" : "none";

  const suggestions = useMemo(() => {
    if (mode === "person") {
      const needle = (parsed.person ?? "").toLowerCase();
      return photographers
        .filter((p) => p.name.toLowerCase() !== value.photographer?.toLowerCase())
        .filter((p) => !needle || p.name.toLowerCase().includes(needle))
        .slice(0, 8)
        .map((p) => ({ kind: "person" as const, value: p.name, count: p.photo_count }));
    }
    if (mode === "tag") {
      const needle = parsed.partialTag ?? "";
      return popularTags
        .filter((t) => !value.tags.includes(t.tag))
        .filter((t) => !needle || t.tag.includes(needle))
        .slice(0, 8)
        .map((t) => ({ kind: "tag" as const, value: t.tag, count: t.photo_count }));
    }
    return [];
  }, [mode, parsed.person, parsed.partialTag, photographers, popularTags, value.tags, value.photographer]);

  /** Typing filters by location live; #tags / @person become chips on Enter */
  const updateDraft = (next: string) => {
    setDraft(next);
    setActive(0);
    const { text } = parseSearch(next);
    if (text !== value.query) onChange({ ...value, query: text });
  };

  const commit = (extra?: { kind: "tag" | "person"; value: string }) => {
    const p = parseSearch(draft);
    let tags = [...value.tags, ...p.tags];
    let photographer = p.person || value.photographer;
    if (extra?.kind === "tag") tags = [...tags.filter((t) => t !== p.partialTag), extra.value];
    if (extra?.kind === "person") photographer = extra.value;
    tags = [...new Set(tags)];
    setDraft(p.text);
    onChange({ query: p.text, tags, photographer: photographer || null });
    inputRef.current?.focus();
  };

  const removeTag = (t: string) => onChange({ ...value, tags: value.tags.filter((x) => x !== t) });
  const clearAll = () => {
    setDraft("");
    onChange({ query: "", tags: [], photographer: null });
  };

  const hasFilters = value.tags.length > 0 || value.query.trim() !== "" || Boolean(value.photographer);
  const showSuggestions = focused && suggestions.length > 0;

  return (
    <div className="relative w-full max-w-xl">
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-neutral-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-neutral-400">
          <path d="M8.5 3a5.5 5.5 0 014.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
        </svg>

        {value.photographer && (
          <span className="flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-900/60 dark:text-amber-100">
            @{value.photographer}
            <button type="button" onClick={() => onChange({ ...value, photographer: null })} aria-label={`Remove photographer ${value.photographer}`} className="opacity-60 hover:opacity-100">×</button>
          </span>
        )}
        {value.tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 dark:bg-sky-950 dark:text-sky-300">
            #{t}
            <button type="button" onClick={() => removeTag(t)} aria-label={`Remove tag ${t}`} className="opacity-60 hover:opacity-100">×</button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => updateDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && showSuggestions) { e.preventDefault(); setActive((a) => (a + 1) % suggestions.length); }
            if (e.key === "ArrowUp" && showSuggestions) { e.preventDefault(); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
            if (e.key === "Enter") {
              e.preventDefault();
              const s = showSuggestions && (parsed.partialTag || parsed.person) ? suggestions[active] : undefined;
              commit(s ? { kind: s.kind, value: s.value } : undefined);
            }
            if (e.key === "Backspace" && !draft) {
              if (value.tags.length) removeTag(value.tags[value.tags.length - 1]);
              else if (value.photographer) onChange({ ...value, photographer: null });
            }
            if (e.key === "Escape") inputRef.current?.blur();
          }}
          placeholder={hasFilters ? "Add more…" : "Search a place, #tag or @photographer"}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-neutral-400"
          aria-label="Search photos"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
        />

        {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" aria-label="Loading" />}
        {hasFilters && (
          <button type="button" onClick={clearAll} className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            Clear
          </button>
        )}
      </div>

      {showSuggestions && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <li className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            {mode === "person" ? "Photographers" : "Tags"}
          </li>
          {suggestions.map((s, i) => (
            <li key={`${s.kind}-${s.value}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit({ kind: s.kind, value: s.value })}
                className={`flex w-full justify-between px-3 py-1.5 text-left ${i === active ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
              >
                <span>{s.kind === "person" ? `@${s.value}` : `#${s.value}`}</span>
                <span className="text-xs text-neutral-400">{s.count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Quick tag chips + result count */}
      <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {popularTags.filter((p) => !value.tags.includes(p.tag)).slice(0, 6).map((p) => (
          <button key={p.tag} type="button" onClick={() => onChange({ ...value, tags: [...value.tags, p.tag] })}
            className="shrink-0 rounded-full border border-neutral-200 bg-white/90 px-2.5 py-1 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/90 dark:text-neutral-300">
            #{p.tag}
          </button>
        ))}
        {resultCount !== undefined && hasFilters && (
          <span className="ml-auto shrink-0 rounded-full bg-neutral-950/70 px-2 py-0.5 text-neutral-200">
            {resultCount} photo{resultCount === 1 ? "" : "s"}
          </span>
        )}
      </div>
    </div>
  );
}
