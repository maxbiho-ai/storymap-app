"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeTag } from "@/lib/tags";
import { geocodeAreas, areaLabel, kindLabel } from "@/lib/geocode";
import { usePopularPhotographers, usePopularTags } from "@/hooks/usePhotoSearch";
import { canonicalCountry, countryFromLocation, splitCountry } from "@/lib/countries";
import { searchWithAi } from "@/lib/aiClient";
import { EMPTY_GEAR, type LightKey } from "@/lib/gear";
import { useMapStore } from "@/store/mapStore";
import type { GeoArea, PhotoFilters } from "@/types/photo";

type Filters = Omit<PhotoFilters, "bounds">;

interface Props {
  value: Filters;
  onChange: (next: Filters) => void;
  resultCount?: number;
  loading?: boolean;
  /** Mobile: the quick tag chips live in the filter popover instead */
  hideChips?: boolean;
}

type Suggestion =
  | { kind: "tag" | "person"; value: string; count: number }
  | { kind: "place"; value: string; area: GeoArea };

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

/** Does the typed text name this place ("germany" → Germany, "frankf" → Frankfurt, Germany)? */
function namesPlace(text: string, area: GeoArea): boolean {
  const t = text.trim().toLowerCase();
  const first = area.name.split(",")[0].trim().toLowerCase();
  return t.length >= 3 && (first === t || first.startsWith(t));
}

/** Search: plain text = location name or a place (country / region / city), #tag, @photographer */
export default function PhotoSearchBar({ value, onChange, resultCount, loading, hideChips }: Props) {
  const popularTags = usePopularTags();
  const photographers = usePopularPhotographers();
  const [draft, setDraft] = useState(value.query);
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(0);
  const [navigated, setNavigated] = useState(false);
  const [places, setPlaces] = useState<GeoArea[]>([]);
  // "✨ AI" mode: the box takes a natural-language request (any language) and an endpoint turns it into filters
  const [aiMode, setAiMode] = useState(false);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const countryFilter = useMapStore((s) => s.countryFilter);
  const setCountryFilter = useMapStore((s) => s.setCountryFilter);
  // A country typed in the box ("iceland waterfall") is the country scope; remember that we set it, so deleting the word lifts it
  const autoCountry = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep the box in sync when the filters are reset from outside (notification click, Clear…)
  const isEmpty = !value.query && !value.tags.length && !value.photographer && !value.area;
  useEffect(() => {
    if (isEmpty) setDraft("");
  }, [isEmpty]);

  const raw = parseSearch(draft);
  const split = aiMode ? { country: null, rest: raw.text } : splitCountry(raw.text);
  const parsed = { ...raw, text: split.rest };
  const mode: "person" | "tag" | "place" =
    parsed.person !== null ? "person" : parsed.partialTag !== null || !draft.trim() ? "tag" : "place";

  // Places from Mapbox Geocoding for plain text (debounced, stale requests aborted)
  const placeQuery = mode === "place" ? parsed.text : "";
  useEffect(() => {
    if (placeQuery.trim().length < 2) {
      setPlaces([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      geocodeAreas(placeQuery, ctrl.signal)
        // With a country scope, only places inside that country are offered
        .then((list) => setPlaces(countryFilter ? list.filter((a) => (a.kind === "country" ? canonicalCountry(a.name) : countryFromLocation(a.name)) === countryFilter) : list))
        .catch(() => {});
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [placeQuery, countryFilter]);

  // The box lost its country word, or the country filter was cleared elsewhere (logo, pill ×): keep both in step
  useEffect(() => {
    if (countryFilter === null && autoCountry.current) {
      autoCountry.current = null;
      setDraft((d) => splitCountry(parseSearch(d).text).rest);
    }
  }, [countryFilter]);

  const suggestions = useMemo<Suggestion[]>(() => {
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
    return places.filter((a) => a.id !== value.area?.id).map((area) => ({ kind: "place" as const, value: area.id, area }));
  }, [mode, parsed.person, parsed.partialTag, photographers, popularTags, places, value.tags, value.photographer, value.area?.id]);

  /** Typing filters by location name live; #tags / @person become chips on Enter; places on pick */
  const updateDraft = (next: string) => {
    setDraft(next);
    setActive(0);
    setNavigated(false);
    if (aiMode) return;
    const { text: full } = parseSearch(next);
    const { country, rest: text } = splitCountry(full);
    if (country) {
      autoCountry.current = country;
      if (country !== countryFilter) setCountryFilter(country);
    } else if (autoCountry.current) {
      autoCountry.current = null;
      setCountryFilter(null);
    }
    if (text !== value.query) onChange({ ...value, query: text });
  };

  const commit = (extra?: Suggestion) => {
    const p = parseSearch(draft);
    if (extra?.kind === "place") {
      // The place replaces the typed text: "Germany" is an area, not a location-name match
      setDraft("");
      setPlaces([]);
      onChange({ ...value, query: "", tags: [...new Set([...value.tags, ...p.tags])], area: extra.area });
      inputRef.current?.blur();
      return;
    }
    let tags = [...value.tags, ...p.tags];
    let photographer = p.person || value.photographer;
    if (extra?.kind === "tag") tags = [...tags.filter((t) => t !== p.partialTag), extra.value];
    if (extra?.kind === "person") photographer = extra.value;
    tags = [...new Set(tags)];
    setDraft(p.text);
    onChange({ ...value, query: p.text, tags, photographer: photographer || null });
    inputRef.current?.focus();
  };

  const removeTag = (t: string) => onChange({ ...value, tags: value.tags.filter((x) => x !== t) });
  const clearAll = () => {
    setDraft("");
    setPlaces([]);
    setAiNote(null);
    autoCountry.current = null;
    setCountryFilter(null);
    onChange({ query: "", tags: [], photographer: null, area: null });
  };

  const runAi = async () => {
    const prompt = draft.trim();
    if (prompt.length < 2 || aiBusy) return;
    if (!useMapStore.getState().currentUserId) return useMapStore.getState().requestLogin();
    setAiBusy(true);
    setAiNote(null);
    try {
      const f = await searchWithAi(prompt, popularTags.map((t) => t.tag));
      const country = canonicalCountry(f.country);
      const tags = [...new Set(f.tags.map(normalizeTag).filter(Boolean))];
      const keywords = f.keywords.join(" ").trim();
      autoCountry.current = null;
      setCountryFilter(country);
      const st = useMapStore.getState();
      st.setGear({ ...EMPTY_GEAR, ...(f.lightPhase ? { light: [f.lightPhase as LightKey] } : {}) });
      onChange({ query: keywords, tags, photographer: null, area: null });
      setDraft("");
      setAiNote([country, ...tags.map((t) => "#" + t), f.lightPhase, keywords].filter(Boolean).join(" · ") || "No filters found");
    } catch (e) {
      setAiNote(e instanceof Error ? e.message : "AI search failed");
    } finally {
      setAiBusy(false);
    }
  };

  const hasFilters = !isEmpty;
  const showSuggestions = focused && suggestions.length > 0;

  const onEnter = () => {
    if (aiMode) return void runAi();
    if (mode === "place") {
      // Arrowed onto a place → that place; otherwise text that names a place ("Germany") → the top match
      const picked = showSuggestions && navigated ? suggestions[active] : undefined;
      const named = suggestions.find((s) => s.kind === "place" && namesPlace(parsed.text, s.area));
      return commit(picked ?? named);
    }
    const s = showSuggestions && (parsed.partialTag || parsed.person) ? suggestions[active] : undefined;
    commit(s);
  };

  return (
    <div className="relative w-full max-w-xl">
      <div className="flex flex-wrap items-center gap-1.5 rounded-2xl border border-neutral-200 bg-white/95 px-3 py-2 shadow-md backdrop-blur dark:border-neutral-800 dark:bg-neutral-900/95">
        <svg aria-hidden viewBox="0 0 20 20" className="h-4 w-4 shrink-0 fill-neutral-400">
          <path d="M8.5 3a5.5 5.5 0 014.38 8.83l3.65 3.64-1.06 1.06-3.64-3.65A5.5 5.5 0 118.5 3zm0 1.5a4 4 0 100 8 4 4 0 000-8z" />
        </svg>
        <button
          type="button"
          onClick={() => { setAiMode((m) => !m); setAiNote(null); setDraft(""); inputRef.current?.focus(); }}
          aria-pressed={aiMode}
          title="AI search: describe what you want in any language"
          className={`flex shrink-0 items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-bold transition max-md:min-h-8 ${aiMode ? "bg-violet-500 text-white" : "bg-neutral-200 text-neutral-600 hover:bg-neutral-300 dark:bg-neutral-800 dark:text-neutral-300 dark:hover:bg-neutral-700"}`}
        >
          ✨ AI
        </button>

        {value.area && (
          <span className="flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
            📍 {areaLabel(value.area)}
            <button type="button" onClick={() => onChange({ ...value, area: null })} aria-label={`Remove place ${value.area.name}`} className="opacity-60 hover:opacity-100">×</button>
          </span>
        )}
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
            if (e.key === "ArrowDown" && showSuggestions) { e.preventDefault(); setNavigated(true); setActive((a) => (a + 1) % suggestions.length); }
            if (e.key === "ArrowUp" && showSuggestions) { e.preventDefault(); setNavigated(true); setActive((a) => (a - 1 + suggestions.length) % suggestions.length); }
            if (e.key === "Enter") {
              e.preventDefault();
              onEnter();
            }
            if (e.key === "Backspace" && !draft) {
              if (value.tags.length) removeTag(value.tags[value.tags.length - 1]);
              else if (value.photographer) onChange({ ...value, photographer: null });
              else if (value.area) onChange({ ...value, area: null });
            }
            if (e.key === "Escape") inputRef.current?.blur();
          }}
          placeholder={aiMode ? "Ask in any language: golden hour mountains in Dolomites…" : hasFilters ? "Add more…" : "Search a place, country (try: iceland waterfall), #tag or @photographer"}
          className="min-w-[8rem] flex-1 bg-transparent py-1 text-sm outline-none placeholder:text-neutral-400 max-md:min-h-10 max-md:text-base"
          aria-label="Search photos"
          aria-autocomplete="list"
          aria-expanded={showSuggestions}
        />

        {aiMode && (
          <button type="button" onClick={() => void runAi()} disabled={aiBusy || draft.trim().length < 2} className="shrink-0 rounded-full bg-violet-500 px-2.5 py-1 text-xs font-semibold text-white hover:bg-violet-400 disabled:opacity-40">
            {aiBusy ? "Thinking…" : "Search"}
          </button>
        )}
        {(loading || aiBusy) && <span className="h-3 w-3 animate-spin rounded-full border-2 border-neutral-300 border-t-neutral-600" aria-label="Loading" />}
        {(hasFilters || countryFilter) && (
          <button type="button" onClick={clearAll} className="text-xs text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200">
            Clear
          </button>
        )}
      </div>

      {aiNote && <p role="status" className="mt-1 rounded-lg bg-violet-950/80 px-3 py-1 text-xs text-violet-100">✨ {aiNote}</p>}

      {showSuggestions && !aiMode && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-20 mt-1 max-h-64 overflow-auto rounded-xl border border-neutral-200 bg-white py-1 text-sm shadow-lg dark:border-neutral-800 dark:bg-neutral-900">
          <li className="px-3 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-neutral-400">
            {mode === "person" ? "Photographers" : mode === "tag" ? "Tags" : "Places · zoom there & show pins inside"}
          </li>
          {suggestions.map((s, i) => (
            <li key={`${s.kind}-${s.value}`} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setActive(i)}
                onClick={() => commit(s)}
                className={`flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left ${i === active ? "bg-neutral-100 dark:bg-neutral-800" : ""}`}
              >
                {s.kind === "place" ? (
                  <>
                    <span className="truncate">📍 {areaLabel(s.area)}</span>
                    <span className="shrink-0 text-xs text-neutral-400">{kindLabel(s.area.kind)}</span>
                  </>
                ) : (
                  <>
                    <span>{s.kind === "person" ? `@${s.value}` : `#${s.value}`}</span>
                    <span className="text-xs text-neutral-400">{s.count}</span>
                  </>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Quick tag chips + result count */}
      <div className={`mt-2 flex items-center gap-1.5 overflow-x-auto pb-1 text-xs ${hideChips ? "hidden" : ""}`}>
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
