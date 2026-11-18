import type { TimeOfDay } from "@/lib/timeOfDay";
import { TIME_OF_DAY_LABEL } from "@/lib/timeOfDay";

const STYLE: Record<TimeOfDay, { bg: string; fg: string }> = {
  sunrise: { bg: "#fde7c8", fg: "#c2410c" },
  day:     { bg: "#fef3c7", fg: "#b45309" },
  sunset:  { bg: "#fbd5d5", fg: "#be123c" },
  night:   { bg: "#1e1b4b", fg: "#c7d2fe" },
};

function Glyph({ t }: { t: TimeOfDay }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (t) {
    case "day":
      return (
        <g {...common}>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" />
        </g>
      );
    case "night":
      return <path {...common} fill="currentColor" stroke="none" d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />;
    case "sunrise":
    case "sunset":
      return (
        <g {...common}>
          <path d="M7 16a5 5 0 0110 0" />
          <path d="M3 20h18M12 4v4" />
          <path d={t === "sunrise" ? "M9.5 6.5L12 4l2.5 2.5" : "M9.5 5.5L12 8l2.5-2.5"} />
          <path d="M4.5 12.5l1.4 1M19.5 12.5l-1.4 1" />
        </g>
      );
  }
}

/** תג עגול קטן עם אייקון זמן הצילום */
export default function TimeIcon({ t, size = 20, className = "" }: { t: TimeOfDay; size?: number; className?: string }) {
  const s = STYLE[t];
  return (
    <span
      title={TIME_OF_DAY_LABEL[t]}
      className={`inline-flex items-center justify-center rounded-full ring-2 ring-white shadow ${className}`}
      style={{ width: size, height: size, background: s.bg, color: s.fg }}
    >
      <svg viewBox="0 0 24 24" width={size * 0.66} height={size * 0.66} aria-hidden>
        <Glyph t={t} />
      </svg>
    </span>
  );
}
