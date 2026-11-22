import "server-only";

/**
 * Minimal Gemini client (REST, structured JSON output).
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-3.5-flash),
 * GEMINI_API_BASE (optional: a proxy / gateway in front of the Gemini API).
 */
export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** Hard cap for any single Gemini call: a hanging model must never block the pin insert */
export const GEMINI_MAX_TIMEOUT_MS = 8_000;

/** gemini-3.8-flash → LOW; gemini-3.5-flash / -lite → MINIMAL (override: GEMINI_THINKING_LEVEL) */
function thinkingLevelFor(model: string): string {
  const o = process.env.GEMINI_THINKING_LEVEL?.trim().toUpperCase();
  if (o) return o;
  return /3\.5/.test(model) ? "MINIMAL" : "LOW";
}

/** capMs: raise the hard cap for batch CLIs (the web routes keep the 8s default) */
export async function geminiJson<T>(parts: Part[], schema: object, timeoutMs = GEMINI_MAX_TIMEOUT_MS, capMs = GEMINI_MAX_TIMEOUT_MS): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";

  const res = await fetch(
    `${(process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(Math.min(timeoutMs, capMs)),
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
          thinkingConfig: { thinkingLevel: thinkingLevelFor(model) },
          responseMimeType: "application/json",
          responseSchema: schema,
        },
      }),
    },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 404 ? ` (model "${model}" not available: set GEMINI_MODEL to a current model)` : "";
    throw new Error(`Gemini HTTP ${res.status}${hint}: ${body.slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  return JSON.parse(text) as T;
}
