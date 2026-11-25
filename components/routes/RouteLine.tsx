import { DAY_COLORS } from "@/lib/trip";
import type { RouteDay } from "@/lib/readyRoutes";

/** Tiny SVG of the ordered route (equirectangular, fitted to the box), one colour per day */
export default function RouteLine({ days, className = "" }: { days: RouteDay[]; className?: string }) {
  const pts = days.flatMap((d) => d.stops);
  if (pts.length < 1) return null;
  const midLat = pts.reduce((a, p) => a + p.latitude, 0) / pts.length;
  const k = Math.cos((midLat * Math.PI) / 180);
  const xs = pts.map((p) => p.longitude * k);
  const ys = pts.map((p) => -p.latitude);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY, 1e-6);
  const W = 100;
  const H = 60;
  const pad = 8;
  const s = Math.min((W - 2 * pad) / span, (H - 2 * pad) / span) * 1;
  const ox = (W - (Math.max(...xs) - minX) * s) / 2;
  const oy = (H - (Math.max(...ys) - minY) * s) / 2;
  const P = (p: { latitude: number; longitude: number }) => [ox + (p.longitude * k - minX) * s, oy + (-p.latitude - minY) * s] as const;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={className} aria-hidden>
      {days.map((d, i) => {
        if (!d.stops.length) return null;
        const c = DAY_COLORS[i % DAY_COLORS.length];
        const path = d.stops.map((p, j) => `${j ? "L" : "M"}${P(p)[0].toFixed(1)},${P(p)[1].toFixed(1)}`).join(" ");
        return (
          <g key={i}>
            {d.stops.length > 1 && <path d={path} fill="none" stroke={c} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" />}
            {d.stops.map((p, j) => (
              <circle key={j} cx={P(p)[0]} cy={P(p)[1]} r={1.9} fill={c} stroke="#0a0a0a" strokeWidth={0.6} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
