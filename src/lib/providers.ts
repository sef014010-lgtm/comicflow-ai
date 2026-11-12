type Keys = { groq: string; together?: string; cerebras?: string };
async function postJson(url: string, key: string, body: unknown) {
  const response = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store", signal: AbortSignal.timeout(30000) });
  const data: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.message || `Provider returned ${response.status}`);
  return data;
}
export async function chatWithFallback(keys: Keys, messages: any[]) {
  const providers = [
    { name: "Groq", key: keys.groq, url: "https://api.groq.com/openai/v1/chat/completions", model: process.env.GROQ_TEXT_MODEL || "llama-3.3-70b-versatile" },
    { name: "Together AI", key: keys.together, url: "https://api.together.xyz/v1/chat/completions", model: process.env.TOGETHER_MODEL || "meta-llama/Llama-3.3-70B-Instruct-Turbo" },
    { name: "Cerebras", key: keys.cerebras, url: "https://api.cerebras.ai/v1/chat/completions", model: process.env.CEREBRAS_MODEL || "llama-3.3-70b" }
  ];
  const errors: string[] = [];
  for (const p of providers) {
    if (!p.key) continue;
    try {
      const data = await postJson(p.url, p.key, { model: p.model, messages, temperature: 0.65 });
      return { provider: p.name, content: data.choices?.[0]?.message?.content || "" };
    } catch (e: any) { errors.push(`${p.name}: ${e.message}`); }
  }
  throw new Error(errors.join(" | ") || "Save a valid Groq API key first.");
}
export async function describeImageBatch(groqKey: string, urls: string[], startIndex: number) {
  const model = process.env.GROQ_VISION_MODEL || "meta-llama/llama-4-scout-17b-16e-instruct";
  const content: any[] = [{ type: "text", text: `Analyze these complete comic/manhwa pages in their given order (page numbers start at ${startIndex + 1}). Describe only visible events, characters, expressions, locations, and important text. Preserve the order of events. Do not infer unseen plot details, character names, or relationships. Return concise numbered page-by-page notes.` }];
  for (const url of urls) content.push({ type: "image_url", image_url: { url } });
  const data = await postJson("https://api.groq.com/openai/v1/chat/completions", groqKey, { model, messages: [{ role: "user", content }], temperature: 0.2 });
  return data.choices?.[0]?.message?.content || "";
}
