import "server-only";

/**
 * Minimal Gemini client (REST, structured JSON output).
 * Env: GEMINI_API_KEY (required), GEMINI_MODEL (default gemini-3.8-flash),
 * GEMINI_API_BASE (optional: a proxy / gateway in front of the Gemini API).
 */
export function geminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

export async function geminiJson<T>(parts: Part[], schema: object, timeoutMs = 25_000): Promise<T> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY is not set");
  const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

  const res = await fetch(
    `${(process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "")}/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      signal: AbortSignal.timeout(timeoutMs),
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0.2,
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
