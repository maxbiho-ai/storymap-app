"use client";

import { useMemo, useState } from "react";
import type { Photo } from "@/types/photo";
import { compassPoint, dayLight, findAzimuthTimes, formatClock, lightDirectionAt } from "@/lib/sunMoon";
import { timezoneAt } from "@/lib/time";

/** Where the light came from at capture time + "Plan Light for Date": when is it there again on a trip date? */
export default function LightPlanner({ photo }: { photo: Photo }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");

  const dir = useMemo(
    () => (photo.taken_at ? lightDirectionAt(new Date(photo.taken_at), photo.latitude, photo.longitude) : null),
    [photo.taken_at, photo.latitude, photo.longitude],
  );
  const tz = photo.taken_tz ?? timezoneAt(photo.latitude, photo.longitude);

  const plan = useMemo(() => {
    if (!dir || !date) return null;
    return {
      hits: findAzimuthTimes(date, photo.latitude, photo.longitude, dir.azimuth, dir.body),
      day: dayLight(date, photo.latitude, photo.longitude),
    };
  }, [dir, date, photo.latitude, photo.longitude]);

  if (!dir) return null;
  const icon = dir.body === "sun" ? "☀️" : "🌙";
  const name = dir.body === "sun" ? "Sun" : "Moon";
  const clock = (d: Date | null) => (d ? formatClock(d, tz) : "–");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-1.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-neutral-400">
        <span title="Direction of the light at capture time (shown on the map around the pin)">
          {icon} {name} at <b className="font-mono tabular-nums text-neutral-200">{Math.round(dir.azimuth)}° {compassPoint(dir.azimuth)}</b>
          <span className="text-neutral-500"> · {Math.round(dir.altitude)}° {dir.altitude >= 0 ? "up" : "below horizon"}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className={`rounded-full border px-2 py-0.5 text-[11px] transition ${open ? "border-amber-300 bg-amber-300/15 text-amber-200" : "border-white/15 text-neutral-300 hover:bg-white/10"}`}
        >
          📅 Plan Light for Date
        </button>
      </div>

      {open && (
        <div className="space-y-1.5 rounded-xl bg-white/5 p-2.5">
          <label className="flex items-center gap-2 text-neutral-300">
            Trip date
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              className="rounded-lg border border-white/10 bg-neutral-900 px-2 py-1 text-xs text-white outline-none [color-scheme:dark] focus:border-amber-300"
            />
          </label>

          {!date && <p className="text-neutral-500">Pick a future date to see when the {name.toLowerCase()} is at {Math.round(dir.azimuth)}° {compassPoint(dir.azimuth)} again.</p>}

          {plan && (
            <>
              <div className="rounded-lg bg-amber-300/10 px-2.5 py-1.5">
                {plan.hits.length ? (
                  <>
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-300">
                      {name} reaches {Math.round(dir.azimuth)}° {compassPoint(dir.azimuth)} at
                    </p>
                    {plan.hits.slice(0, 3).map((h) => (
                      <p key={h.time.getTime()} className="text-sm text-white">
                        <b className="font-mono tabular-nums">{clock(h.time)}</b>
                        <span className="text-neutral-400"> local · {Math.round(h.altitude)}° {h.altitude >= 0 ? "high" : "below horizon"}</span>
                      </p>
                    ))}
                  </>
                ) : (
                  <p className="text-neutral-300">
                    The {name.toLowerCase()} never reaches {Math.round(dir.azimuth)}° {compassPoint(dir.azimuth)} in usable light on that date
                    {dir.body === "moon" ? " (moon positions change a lot day to day: try the next night)" : ""}.
                  </p>
                )}
              </div>
              <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5 font-mono text-[11px] tabular-nums text-neutral-300">
                {plan.day.polar ? (
                  <p className="col-span-2 font-sans text-neutral-400">Polar day or night: no regular sunrise or sunset on this date.</p>
                ) : (
                  <>
                    <Row k="Blue hour starts" v={clock(plan.day.blueDawn)} />
                    <Row k="Sunrise" v={clock(plan.day.sunrise)} />
                    <Row k="Golden hour ends" v={clock(plan.day.goldenMorningEnd)} />
                    <Row k="Golden hour starts" v={clock(plan.day.goldenEveningStart)} />
                    <Row k="Sunset" v={clock(plan.day.sunset)} />
                    <Row k="Blue hour ends" v={clock(plan.day.blueDusk)} />
                  </>
                )}
              </dl>
              <p className="text-[10px] text-neutral-500">Times are local{tz ? ` (${tz})` : ""}. Light only: weather and terrain still decide.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="font-sans text-neutral-500">{k}</dt>
      <dd>{v}</dd>
    </div>
  );
}
