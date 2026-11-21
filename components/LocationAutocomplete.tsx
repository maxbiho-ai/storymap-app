"use client";

import { useEffect, useId, useRef, useState } from "react";
import { searchPlaces, kindLabel, type PlaceSuggestion } from "@/lib/geocode";

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** A suggestion was picked (the text is already set to its name) */
  onSelect?: (s: PlaceSuggestion) => void;
  /** Bias results toward this point (the photo's GPS) */
  proximity?: { latitude: number; longitude: number } | null;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** "dark": the photo card; "auto": light panel with dark: variants */
  theme?: "dark" | "auto";
  inputClassName?: string;
  /** Enter with no highlighted suggestion */
  onSubmit?: () => void;
  onCancel?: () => void;
  ariaLabel?: string;
}

/**
 * Text input with live Mapbox place autocomplete (landmarks, peaks, towns, streets).
 * The dropdown renders in-flow (not absolutely positioned) so it is never clipped
 * by the card's or the upload panel's overflow.
 */
export default function LocationAutocomplete({
  value, onChange, onSelect, proximity, placeholder, disabled, autoFocus, theme = "auto", inputClassName, onSubmit, onCancel, ariaLabel,
}: Props) {
  const [results, setResults] = useState<PlaceSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [loading, setLoading] = useState(false);
  /** Only search after the user types: never on a programmatic prefill */
  const typed = useRef(false);
  const listId = useId();
  const lat = proximity?.latitude;
  const lng = proximity?.longitude;

  useEffect(() => {
    if (!typed.current) return;
    const q = value.trim();
    if (q.length < 2) {
      setResults([]);
      setLoading(false);
      return;
    }
    const ctrl = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      searchPlaces(q, { proximity: lat != null && lng != null ? { latitude: lat, longitude: lng } : null, signal: ctrl.signal })
        .then((r) => {
          setResults(r);
          setActive(-1);
          setOpen(true);
        })
        .catch((err) => {
          if ((err as Error).name !== "AbortError") setResults([]);
        })
        .finally(() => !ctrl.signal.aborted && setLoading(false));
    }, 250);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [value, lat, lng]);

  const choose = (s: PlaceSuggestion) => {
    typed.current = false;
    onChange(s.name);
    onSelect?.(s);
    setOpen(false);
    setResults([]);
  };

  const showList = open && results.length > 0;
  const dark = theme === "dark";

  return (
    <div className="w-full">
      <div className="relative">
        <input
          type="text"
          value={value}
          disabled={disabled}
          autoFocus={autoFocus}
          placeholder={placeholder}
          aria-label={ariaLabel ?? placeholder}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          autoComplete="off"
          className={inputClassName}
          onChange={(e) => {
            typed.current = true;
            onChange(e.target.value);
          }}
          onFocus={() => results.length && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" && showList) {
              e.preventDefault();
              setActive((i) => (i + 1) % results.length);
            } else if (e.key === "ArrowUp" && showList) {
              e.preventDefault();
              setActive((i) => (i <= 0 ? results.length - 1 : i - 1));
            } else if (e.key === "Enter") {
              e.preventDefault();
              if (showList && active >= 0) choose(results[active]);
              else onSubmit?.();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              e.nativeEvent.stopImmediatePropagation();
              if (showList) setOpen(false);
              else onCancel?.();
            }
          }}
        />
        {loading && (
          <span className={`pointer-events-none absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-2 border-t-transparent ${dark ? "border-white/50" : "border-neutral-400"}`} />
        )}
      </div>

      {showList && (
        <ul
          id={listId}
          role="listbox"
          className={`mt-1 max-h-56 overflow-y-auto rounded-lg border text-left shadow-lg ${
            dark ? "border-white/10 bg-neutral-900" : "border-neutral-200 bg-white dark:border-neutral-700 dark:bg-neutral-800"
          }`}
        >
          {results.map((s, i) => (
            <li key={s.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()} // keep focus: blur would close the list first
                onClick={() => choose(s)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-start gap-2 px-2.5 py-1.5 text-left ${
                  i === active ? (dark ? "bg-white/10" : "bg-amber-50 dark:bg-neutral-700") : ""
                }`}
              >
                <span className="min-w-0 flex-1">
                  <span className={`block truncate text-xs font-medium ${dark ? "text-white" : "text-neutral-900 dark:text-neutral-100"}`}>{s.name}</span>
                  <span className={`block truncate text-[10px] ${dark ? "text-neutral-400" : "text-neutral-500"}`}>{s.full}</span>
                </span>
                <span className={`mt-0.5 shrink-0 rounded px-1 text-[9px] uppercase tracking-wide ${dark ? "bg-white/10 text-neutral-300" : "bg-neutral-100 text-neutral-500 dark:bg-neutral-700 dark:text-neutral-300"}`}>
                  {kindLabel(s.kind)}
                </span>
              </button>
            </li>
          ))}
          <li className={`px-2.5 py-1 text-right text-[9px] ${dark ? "text-neutral-500" : "text-neutral-400"}`}>Search by Mapbox</li>
        </ul>
      )}
    </div>
  );
}

/** One-click chips for reverse-geocoded names of a point */
export function PlaceChips({
  suggestions, current, onPick, theme = "auto", label = "Suggested",
}: {
  suggestions: PlaceSuggestion[];
  current?: string;
  onPick: (s: PlaceSuggestion) => void;
  theme?: "dark" | "auto";
  label?: string;
}) {
  const list = suggestions.filter((s) => s.name !== current);
  if (!list.length) return null;
  const dark = theme === "dark";
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1">
      <span className={`text-[10px] ${dark ? "text-neutral-500" : "text-neutral-500"}`}>{label}:</span>
      {list.map((s) => (
        <button
          key={s.id}
          type="button"
          onClick={() => onPick(s)}
          title={`${s.full} (${kindLabel(s.kind)})`}
          className={`max-w-full truncate rounded-full px-2 py-0.5 text-[10px] font-medium transition ${
            dark ? "bg-amber-300/15 text-amber-200 hover:bg-amber-300/30" : "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-950 dark:text-amber-200"
          }`}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}
