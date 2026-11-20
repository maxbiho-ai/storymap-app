"use client";

export default function PickModeBanner({ onCancel }: { onCancel: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-28 z-10 flex justify-center px-4 md:top-32">
      <div className="pointer-events-auto flex items-center gap-3 rounded-full bg-amber-300 py-2 pe-2 ps-4 text-sm font-medium text-neutral-900 shadow-xl">
        <span className="relative flex h-2.5 w-2.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-neutral-900/60" />
          <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-neutral-900" />
        </span>
        Click the map to set the photo location
        <button type="button" onClick={onCancel} className="rounded-full bg-neutral-900/10 px-3 py-1 text-xs hover:bg-neutral-900/20">
          Cancel (Esc)
        </button>
      </div>
    </div>
  );
}
