import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireAppPassword, decryptText } from "@/lib/security";
import { readPrivateJson, savePublicAsset, SETTINGS_PATH } from "@/lib/blob";
import { extractComicImages, downloadPageImage } from "@/lib/scrape";
import { chatWithFallback, describeImageBatch } from "@/lib/providers";
import { writeJob } from "@/lib/jobs";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  try {
    requireAppPassword(request);
    const body = await request.json();
    const urls: string[] = Array.isArray(body.urls) ? (body.urls as unknown[]).map((v: unknown) => String(v).trim()).filter((value: string) => value.length > 0) : [];
    const format = body.format === "landscape" ? "landscape" : "shorts";
    const tone = String(body.tone || "cinematic, engaging and suspenseful").slice(0, 120);
    if (!urls.length || urls.length > 3) return NextResponse.json({ error: "Enter between 1 and 3 chapter URLs." }, { status: 400 });
    if (urls.some(url => url.length > 2048)) return NextResponse.json({ error: "Each chapter URL must be 2,048 characters or fewer." }, { status: 400 });
    const stored = await readPrivateJson(SETTINGS_PATH);
    if (!stored?.encrypted) return NextResponse.json({ error: "Save your Groq API key first." }, { status: 400 });
    const keys = JSON.parse(decryptText(stored.encrypted));
    const discoveredGroups = await Promise.all(urls.map(url => extractComicImages(url)));
    const unique = [...new Set(discoveredGroups.flat())].slice(0, 12);
    if (!unique.length) throw new Error("No page images were found.");
    const id = crypto.randomUUID();
    const pages: Array<{ url: string; page: number }> = [];
    const notes: string[] = [];
    const storedPages = await Promise.all(unique.map(async (sourceUrl, index) => {
      const { bytes, type } = await downloadPageImage(sourceUrl);
      const asset = await savePublicAsset(`comicflow/jobs/${id}/pages/page-${String(index + 1).padStart(3, "0")}`, bytes, type);
      return { url: asset.url, page: index + 1 };
    }));
    pages.push(...storedPages);
    for (let i = 0; i < pages.length; i += 4) {
      const batch = pages.slice(i, i + 4);
      notes.push(await describeImageBatch(keys.groq, batch.map(p => p.url), i));
    }
    const visualNotes = notes.join("\n\n");
    const prompt = `You are a professional YouTube comic recap writer. Write original spoken narration in American English based only on the visible page notes below. Never invent events, names, motivations, or relationships. Maintain chronological order and use transitions between pages. Avoid describing the page layout; narrate the story. Tone: ${tone}. Output length: ${format === "shorts" ? "about 45-60 seconds (110-145 words)" : "about 3-5 minutes (420-650 words)"}. Create a strong hook, clear progression, and an ending that encourages viewers to watch the next part without falsely claiming a cliffhanger. Return JSON with narration, youtubeTitle, description, keywords (array), hashtags (array).\n\nPAGE NOTES:\n${visualNotes}`;
    const generated = await chatWithFallback(keys, [
      { role: "system", content: "Return valid JSON only. All text fields must be in American English. Do not include markdown fences." },
      { role: "user", content: prompt }
    ]);
    let result: any;
    try { result = JSON.parse(generated.content); }
    catch { throw new Error("The AI provider returned an invalid script format. Please try again."); }
    if (typeof result.narration !== "string" || result.narration.trim().length < 30 || result.narration.length > 7000) throw new Error("The AI did not produce a usable narration script within the 7,000-character limit.");
    const cleanList = (value: unknown, maxItems: number, maxLength: number) => Array.isArray(value)
      ? value.map(item => String(item).trim().slice(0, maxLength)).filter(Boolean).slice(0, maxItems)
      : [];
    const job = await writeJob({
      id, status: "script_ready", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), format,
      sourceUrls: urls, pages, visualNotes, narration: result.narration,
      youtubeTitle: String(result.youtubeTitle || "Comic Recap").trim().slice(0, 160), description: String(result.description || "").trim().slice(0, 5000),
      keywords: cleanList(result.keywords, 25, 80), hashtags: cleanList(result.hashtags, 12, 60), provider: generated.provider
    });
    return NextResponse.json(job);
  } catch (e: any) { return NextResponse.json({ error: e.message || "Analysis failed." }, { status: 400 }); }
}
