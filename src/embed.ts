// Embeddings via any OpenAI-compatible /v1/embeddings endpoint.
// Returns null when unconfigured or on failure — callers fall back to keyword search.

export async function embedText(text: string): Promise<number[] | null> {
  const apiKey = process.env.EMBED_API_KEY;
  if (!apiKey) return null;
  const url = process.env.EMBED_API_URL ?? "https://api.openai.com/v1/embeddings";
  const model = process.env.EMBED_MODEL ?? "text-embedding-3-small";

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ model, input: text.slice(0, 8000) }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch {
    return null;
  }
}

// The text an item is indexed by: weighted toward title, brand and category.
// Category-specific attributes are flattened in ("size eu: 43") so they are
// semantically searchable too.
export function itemEmbeddingText(input: {
  title: string;
  description: string;
  category: string;
  condition: string;
  brand?: string | null;
  attributes?: Record<string, string | number | boolean>;
}): string {
  return [
    input.title,
    input.title,
    input.brand ?? "",
    input.category,
    input.condition.replace(/_/g, " "),
    input.description,
    Object.entries(input.attributes ?? {})
      .map(([k, v]) => `${k.replace(/_/g, " ")}: ${v}`)
      .join("\n"),
  ]
    .filter(Boolean)
    .join("\n");
}
