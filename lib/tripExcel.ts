"use client";

import { DAY_COLORS, DEFAULT_START, daySchedule, fmtDuration, formatDay, mapsLink, type Trip } from "@/lib/trip";

const COLS = [
  { header: "Location / Spot", width: 34 },
  { header: "Address / Coordinates", width: 30 },
  { header: "Arrival Time", width: 13 },
  { header: "Duration", width: 11 },
  { header: "Logistics / Tickets", width: 34 },
  { header: "Photography Notes & Transit", width: 60 },
];
/** Excel column width (characters) → pixels */
const px = (w: number) => Math.round(w * 7 + 5);
const IMG_H = 120;
const GAP = 10;

async function loadImage(src: string): Promise<{ b64: string; ext: "jpeg" | "png"; w: number; h: number } | null> {
  try {
    let blob: Blob;
    if (src.startsWith("data:")) blob = await (await fetch(src)).blob();
    else {
      const res = await fetch(src, { mode: "cors" });
      if (!res.ok) return null;
      blob = await res.blob();
    }
    const bmp = await createImageBitmap(blob);
    const { width: w, height: h } = bmp;
    bmp.close();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = "";
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { b64: btoa(bin), ext: blob.type.includes("png") ? "png" : "jpeg", w, h };
  } catch {
    return null;
  }
}

/** Absolute x (pixels from the left edge of column A) → ExcelJS fractional column index */
function colAt(x: number): number {
  let left = x;
  for (let c = 0; c < COLS.length; c++) {
    const w = px(COLS[c].width);
    if (left < w) return c + left / w;
    left -= w;
  }
  return COLS.length - 0.001;
}

/** A formatted travel workbook: a coloured banner per day, one row per stop, and the stop's reference photos embedded in the row beneath it */
export async function exportTripXlsx(trip: Trip): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = "StoryMap";
  const ws = wb.addWorksheet("Itinerary", { views: [{ state: "frozen", ySplit: 3 }], pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 } });
  ws.columns = COLS.map((c) => ({ width: c.width }));

  const title = ws.addRow([`${trip.name || "Photo trip"}  |  ${formatDay(trip.startDate)}${trip.endDate !== trip.startDate ? ` to ${formatDay(trip.endDate)}` : ""}`]);
  ws.mergeCells(title.number, 1, title.number, COLS.length);
  title.height = 30;
  title.getCell(1).font = { bold: true, size: 16, color: { argb: "FF111111" } };
  title.getCell(1).alignment = { vertical: "middle" };
  ws.addRow([]);
  const head = ws.addRow(COLS.map((c) => c.header));
  head.height = 22;
  head.eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF262626" } };
    c.alignment = { vertical: "middle", horizontal: "left" };
  });

  const border = { bottom: { style: "thin" as const, color: { argb: "FFE5E5E5" } } };
  for (let di = 0; di < trip.days.length; di++) {
    const day = trip.days[di];
    if (!day.stops.length) continue;
    const color = DAY_COLORS[di % DAY_COLORS.length].replace("#", "FF").toUpperCase();
    const timed = daySchedule(day);
    const dest = day.stops[0].name.split(",")[0];
    const banner = ws.addRow([`Day ${di + 1}  |  ${formatDay(day.date)}  |  Start ${day.startTime ?? DEFAULT_START}  |  ${dest}`]);
    ws.mergeCells(banner.number, 1, banner.number, COLS.length);
    banner.height = 26;
    banner.getCell(1).font = { bold: true, size: 13, color: { argb: "FF111111" } };
    banner.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
    banner.getCell(1).alignment = { vertical: "middle" };

    for (let si = 0; si < day.stops.length; si++) {
      const s = day.stops[si];
      const t = timed[si];
      const transit = si > 0 && (s.transitMinutes || s.transitNote) ? `Transit: ${[s.transitMinutes ? `${s.transitMinutes} min` : null, s.transitNote].filter(Boolean).join(", ")}` : null;
      const notes = [s.description ?? s.note, transit].filter(Boolean).join("\n");
      const row = ws.addRow([`${si + 1}. ${s.name}`, "", t.arrive, fmtDuration(t.duration), s.logistics ?? "", notes]);
      row.getCell(2).value = { text: `${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}`, hyperlink: mapsLink(s) };
      row.getCell(2).font = { color: { argb: "FF1D4ED8" }, underline: true };
      row.getCell(1).font = { bold: true };
      row.getCell(3).font = { bold: true };
      row.eachCell((c) => {
        c.alignment = { vertical: "top", wrapText: true };
        c.border = border;
      });
      row.height = Math.max(32, Math.min(150, 16 * Math.max(1, Math.ceil(notes.length / 70) + (s.logistics ? Math.ceil(s.logistics.length / 38) - 1 : 0))));

      const imgs = (await Promise.all((s.refPhotos ?? []).map(loadImage))).filter((x): x is NonNullable<typeof x> => x !== null);
      if (imgs.length) {
        const imgRow = ws.addRow([""]);
        ws.mergeCells(imgRow.number, 1, imgRow.number, COLS.length);
        imgRow.height = IMG_H * 0.75 + 8; // points
        let x = 6;
        for (const im of imgs) {
          const w = Math.round((im.w / im.h) * IMG_H);
          const id = wb.addImage({ base64: im.b64, extension: im.ext });
          ws.addImage(id, { tl: { col: colAt(x), row: imgRow.number - 1 + 0.04 }, ext: { width: w, height: IMG_H }, editAs: "oneCell" });
          x += w + GAP;
        }
      }
    }
    ws.addRow([]);
  }

  const buf = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${trip.name.replace(/[^\w-]+/g, "_") || "photo-trip"}.xlsx`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
