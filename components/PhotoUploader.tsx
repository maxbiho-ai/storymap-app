"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { extractExif } from "@/lib/exif";
import { compressImage, type CompressedImage } from "@/lib/compress";
import { uploadPhoto } from "@/lib/upload";
import { normalizeTag } from "@/lib/tags";
import type { ExtractedExif, Photo } from "@/types/photo";

type Stage = "idle" | "reading" | "compressing" | "ready" | "uploading" | "saving" | "done" | "error";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "",
  reading: "קורא נתוני EXIF…",
  compressing: "מכווץ תמונה…",
  ready: "מוכן להעלאה",
  uploading: "מעלה לשרת…",
  saving: "שומר במסד הנתונים…",
  done: "התמונה עלתה ✓",
  error: "שגיאה",
};

interface Props {
  /** נקרא אחרי שמירה מוצלחת — להוספת הסמן למפה */
  onUploaded?: (photo: Photo) => void;
  /**
   * מיקום שנבחר במפה (לחיצה על המפה) — לתמונות בלי GPS
   * או כשרוצים לתקן את המיקום מה-EXIF.
   */
  pickedLocation?: { latitude: number; longitude: number } | null;
  /** מבקש מהמפה להיכנס למצב "בחר מיקום" */
  onRequestLocationPick?: () => void;
  /** נקרא כשהטופס מתאפס (ביטול / אחרי העלאה) — לניקוי סמן הבחירה במפה */
  onReset?: () => void;
}

export default function PhotoUploader({ onUploaded, pickedLocation, onRequestLocationPick, onReset }: Props) {
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [compressPct, setCompressPct] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);
  const [original, setOriginal] = useState<File | null>(null);
  const [compressed, setCompressed] = useState<CompressedImage | null>(null);
  const [exif, setExif] = useState<ExtractedExif | null>(null);

  const [title, setTitle] = useState("");
  const [locationName, setLocationName] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [isPrivate, setIsPrivate] = useState(false);
  const [manualLat, setManualLat] = useState("");
  const [manualLng, setManualLng] = useState("");

  const inputRef = useRef<HTMLInputElement>(null);

  // מיקום שנבחר במפה ממלא את השדות הידניים
  useEffect(() => {
    if (pickedLocation) {
      setManualLat(pickedLocation.latitude.toFixed(6));
      setManualLng(pickedLocation.longitude.toFixed(6));
    }
  }, [pickedLocation]);

  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const reset = () => {
    setStage("idle"); setError(null); setCompressPct(0);
    setPreview(null); setOriginal(null); setCompressed(null); setExif(null);
    setTitle(""); setLocationName(""); setTags([]); setTagDraft("");
    setIsPrivate(false); setManualLat(""); setManualLng("");
    if (inputRef.current) inputRef.current.value = "";
    onReset?.();
  };

  const handleFile = useCallback(async (file: File) => {
    if (!file.type.startsWith("image/") && !/\.(heic|heif)$/i.test(file.name)) {
      setError("הקובץ אינו תמונה"); setStage("error"); return;
    }
    setError(null);
    setOriginal(file);
    try {
      // (א) EXIF — מהקובץ המקורי, לפני כיווץ
      setStage("reading");
      const meta = await extractExif(file);
      setExif(meta);
      // אין GPS → המפה עוברת מיד למצב "בחר מיקום" (הכיווץ ממשיך ברקע)
      if ((meta.latitude == null || meta.longitude == null) && onRequestLocationPick) {
        onRequestLocationPick();
      }

      // (ב) כיווץ
      setStage("compressing");
      const result = await compressImage(file, setCompressPct);
      setCompressed(result);
      setPreview(URL.createObjectURL(result.file));
      setStage("ready");
    } catch (e) {
      setError(e instanceof Error ? e.message : "עיבוד התמונה נכשל");
      setStage("error");
    }
  }, [onRequestLocationPick]);

  const addTag = (raw: string) => {
    const t = normalizeTag(raw);
    if (t && !tags.includes(t)) setTags((prev) => [...prev, t]);
    setTagDraft("");
  };

  const manualLocation =
    manualLat !== "" && manualLng !== "" && !Number.isNaN(+manualLat) && !Number.isNaN(+manualLng)
      ? { latitude: +manualLat, longitude: +manualLng }
      : null;
  const hasGps = exif?.latitude != null && exif?.longitude != null;
  const canUpload = stage === "ready" && compressed && (hasGps || manualLocation);

  const submit = async () => {
    if (!compressed || !exif) return;
    try {
      setStage("uploading");
      // (ג) Storage → (ד) DB
      const photo = await uploadPhoto(compressed, exif, {
        title,
        location_name: locationName,
        tags: tagDraft ? [...tags, normalizeTag(tagDraft)].filter(Boolean) : tags,
        is_private: isPrivate,
        manualLocation,
      }, setStage);
      setStage("done");
      onUploaded?.(photo);
      setTimeout(reset, 1500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ההעלאה נכשלה");
      setStage("error");
    }
  };

  const busy = stage === "reading" || stage === "compressing" || stage === "uploading" || stage === "saving";

  return (
    <div dir="rtl" className="w-full max-w-md space-y-4 rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm dark:border-neutral-800 dark:bg-neutral-900">
      {/* אזור בחירה / גרירה */}
      {!compressed && (
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-neutral-300 p-8 text-center text-sm text-neutral-500 hover:border-neutral-400 dark:border-neutral-700"
        >
          <span className="text-base font-medium text-neutral-700 dark:text-neutral-200">גרור תמונה לכאן או לחץ לבחירה</span>
          <span>JPEG / PNG / HEIC — תכווץ אוטומטית ל-2048px</span>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,.heic,.heif"
            className="hidden"
            disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
          />
        </label>
      )}

      {/* סטטוס */}
      {stage !== "idle" && (
        <div className="text-sm">
          <span className={stage === "error" ? "text-red-600" : "text-neutral-600 dark:text-neutral-300"}>
            {STAGE_LABEL[stage]}
            {stage === "compressing" && ` ${compressPct}%`}
          </span>
          {error && <p className="mt-1 text-red-600">{error}</p>}
        </div>
      )}

      {/* תצוגה מקדימה + נתונים */}
      {compressed && preview && (
        <>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="" className="max-h-64 w-full rounded-xl object-cover" />

          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-neutral-600 dark:text-neutral-400">
            <dt>גודל</dt>
            <dd dir="ltr" className="text-left">
              {original && `${(original.size / 1e6).toFixed(1)}MB → `}
              {(compressed.file.size / 1e3).toFixed(0)}KB · {compressed.width}×{compressed.height}
            </dd>
            {exif?.camera_model && (<><dt>מצלמה</dt><dd dir="ltr" className="text-left">{[exif.camera_make, exif.camera_model].filter(Boolean).join(" ")}</dd></>)}
            {exif?.lens && (<><dt>עדשה</dt><dd dir="ltr" className="text-left">{exif.lens}</dd></>)}
            {(exif?.aperture || exif?.shutter_speed || exif?.iso) && (
              <><dt>חשיפה</dt><dd dir="ltr" className="text-left">
                {[exif.focal_length && `${exif.focal_length}mm`, exif.aperture && `f/${exif.aperture}`, exif.shutter_speed, exif.iso && `ISO ${exif.iso}`].filter(Boolean).join(" · ")}
              </dd></>
            )}
            {exif?.taken_at && (<><dt>צולם</dt><dd>{new Date(exif.taken_at).toLocaleString("he-IL")}</dd></>)}
            <dt>GPS</dt>
            <dd dir="ltr" className="text-left">
              {hasGps ? `${exif!.latitude!.toFixed(5)}, ${exif!.longitude!.toFixed(5)}` : <span className="text-amber-600">אין — בחר מיקום</span>}
            </dd>
          </dl>

          {/* מיקום ידני */}
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{hasGps ? "תיקון מיקום (אופציונלי)" : "מיקום (חובה)"}</legend>
            <div className="flex gap-2" dir="ltr">
              <input value={manualLat} onChange={(e) => setManualLat(e.target.value)} placeholder="Lat" inputMode="decimal" className="w-full rounded-lg border px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
              <input value={manualLng} onChange={(e) => setManualLng(e.target.value)} placeholder="Lng" inputMode="decimal" className="w-full rounded-lg border px-2 py-1.5 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
            </div>
            {onRequestLocationPick && (
              <button type="button" onClick={onRequestLocationPick} className="text-sm text-blue-600 hover:underline">
                בחר נקודה על המפה
              </button>
            )}
          </fieldset>

          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="כותרת" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />
          <input value={locationName} onChange={(e) => setLocationName(e.target.value)} placeholder="שם מיקום (למשל: מצדה, Murchison Falls)" className="w-full rounded-lg border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800" />

          {/* תגיות */}
          <div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {tags.map((t) => (
                <button key={t} type="button" onClick={() => setTags(tags.filter((x) => x !== t))}
                  className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs dark:bg-neutral-800" title="הסר">
                  #{t} ×
                </button>
              ))}
            </div>
            <input
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "," || e.key === " ") { e.preventDefault(); addTag(tagDraft); }
                if (e.key === "Backspace" && !tagDraft && tags.length) setTags(tags.slice(0, -1));
              }}
              placeholder="תגיות: sunrise, milkyway… (Enter להוספה)"
              className="w-full rounded-lg border px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-800"
            />
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={isPrivate} onChange={(e) => setIsPrivate(e.target.checked)} />
            תמונה פרטית (רק אני רואה)
          </label>

          <div className="flex gap-2">
            <button type="button" onClick={submit} disabled={!canUpload || busy}
              className="flex-1 rounded-lg bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-40 dark:bg-white dark:text-neutral-900">
              {busy ? STAGE_LABEL[stage] : "העלה למפה"}
            </button>
            <button type="button" onClick={reset} disabled={busy} className="rounded-lg border px-4 py-2 text-sm dark:border-neutral-700">
              ביטול
            </button>
          </div>
        </>
      )}
    </div>
  );
}
