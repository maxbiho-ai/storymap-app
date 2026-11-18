"use client";

import { useMemo, useRef, useState } from "react";
import { normalizeTag } from "@/lib/tags";
import { usePopularTags } from "@/hooks/usePhotoSearch";
import type { PhotoFilters } from "@/types/photo";

interface Props {
  value: PhotoFilters;
  onChange: (next: PhotoFilters) => void;
  resultCount?: number;
  loading?: boolean;
}

/**
 * סרגל חיפוש וסינון:
 * - הקלדה חופשית → מחפש בשם מיקום, כותרת, ותגית מדויקת
 * - "#sunrise" + Enter (או בחירה מההצעות) → הופך לצ'יפ תגית (סינון AND)
 * - צ'יפים של תגיות פופולריות לסינון בלחיצה
 */
export default function PhotoSearchBar({ value, onChange, resultCount, loading }: Props) {
  const popular = usePopularTags();
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const draft = value.query;
  const isTagMode = draft.trim().startsWith("#");

  const suggestions = useMemo(() => {
    const needle = normalizeTag(draft);
    return popular
      .filter((p) => !value.tags.includes(p.tag))
      .filter((p) => !needle || p.tag.includes(needle))
      .slice(0, 8);
  }, [popular, draft, value.tags]);

  const setQuery = (query: string) => onChange({ ...value, query });

  const addTag = (raw: string) => {
    const t = normalizeTag(raw);
    if (!t || value.tags.includes(t)) return setQuery("");
    onChange({ ...value, tags: [...value.tags, t], query: "" });
    inputRef.current?.focus();
  };

  const removeTag = (t: string) => onChange({ ...value, tags: value.tags.filter((x) => x !== t) });

  const clearAll = () => onChange({ ...value, tags: [], query: "" });

  const hasFilters = value.tags.length > 0 || value.query.trim() !== "";

  return (
    <div dir="rtl" className="relative w-full max-w-xl">
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-neutral-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-neutral-400">
          <path d="M8.5 3a5.5 5.5 0 014.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
        </svg>

        {value.tags.map((t) => (
          <span key={t} className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            #{t}
            <button type="button" onClick={() => removeTag(t)} aria-label={`הסר ${t}`} className="opacity-60 hover:opacity-100">×</button>
          </span>
        ))}

        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && isTagMode) { e.preventDefault(); addTag(draft); }
            if (e.key === "Backspace" && !draft && value.tags.length) removeTag(value.tags[value.tags.length - 1]);
            if (e.key === "Escape") inputRef.current?.blur();
          }}
          placeholder={value.tags.length ? "הוסף עוד…" : "חפש מיקום, או #תגית (sunrise, milkyway…)"}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-neutral-400"
          aria-label="חיפוש תמונות"
        />

        {loading && <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" aria-label="טוען" />}
        {hasFilters && (
          <button type="button" onClick={clearAll} className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            נקה
          </button>
        )}
      </div>

      {/* הצעות תגיות */}
      {focused && suggestions.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          {suggestions.map((s) => (
            <li key={s.tag}>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => addTag(s.tag)}
                className="flex w-full justify-between px-3 py-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800">
                <span>#{s.tag}</span>
                <span className="text-xs text-neutral-400">{s.photo_count}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* צ'יפים מהירים + מונה */}
      <div className="mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
        {popular.filter((p) => !value.tags.includes(p.tag)).slice(0, 6).map((p) => (
          <button key={p.tag} type="button" onClick={() => addTag(p.tag)}
            className="shrink-0 rounded-full border border-neutral-200 bg-white/90 px-2.5 py-1 text-neutral-600 hover:bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/90 dark:text-neutral-300">
            #{p.tag}
          </button>
        ))}
        {resultCount !== undefined && hasFilters && (
          <span className="ms-auto shrink-0 text-neutral-500">{resultCount} תמונות</span>
        )}
      </div>
    </div>
  );
}
