"use client";

import { useState } from "react";

interface Props {
  tags: string[];
  loading?: boolean;
  onAdd: (tag: string) => void;
  onRemove: (tag: string) => void;
}

/** Review AI tags: remove with ×, add with Enter / comma / space */
export default function TagEditor({ tags, loading, onAdd, onRemove }: Props) {
  const [draft, setDraft] = useState("");
  const commit = () => {
    draft.split(/[,\s]+/).filter(Boolean).forEach(onAdd);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1">
      {tags.map((t) => (
        <span key={t} className="flex items-center gap-0.5 rounded-full bg-sky-50 py-0.5 pl-2 pr-1 text-[11px] text-sky-800 dark:bg-sky-950 dark:text-sky-200">
          #{t}
          <button type="button" onClick={() => onRemove(t)} aria-label={`Remove tag ${t}`} className="rounded-full px-1 opacity-60 hover:opacity-100">
            ×
          </button>
        </span>
      ))}
      {loading && (
        <span className="flex items-center gap-1 rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] text-neutral-500 dark:bg-neutral-800">
          <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
          Suggesting tags…
        </span>
      )}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === "," || e.key === " ") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Backspace" && !draft && tags.length) onRemove(tags[tags.length - 1]);
        }}
        onBlur={commit}
        placeholder="+ tag"
        aria-label="Add a tag"
        className="min-w-[4rem] flex-1 bg-transparent px-1 py-0.5 text-[11px] outline-none placeholder:text-neutral-400"
      />
    </div>
  );
}
