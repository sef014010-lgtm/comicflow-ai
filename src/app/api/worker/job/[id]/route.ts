import { NextResponse } from "next/server";
import { requireWorkerSecret } from "@/lib/security";
import { readJob, updateJob } from "@/lib/jobs";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireWorkerSecret(request);
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
    const job = await readJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (job.status !== "extracting") return NextResponse.json({ error: `Job is not awaiting extraction (status: ${job.status}).` }, { status: 409 });
    return NextResponse.json({ id: job.id, sourceUrls: job.sourceUrls, format: job.format, tone: job.tone || "cinematic, engaging and suspenseful" });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Worker request failed." }, { status: 401 }); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireWorkerSecret(request);
    const { id } = await context.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
    const body = await request.json();
    const job = await readJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (body.status === "script_ready") {
      if (!Array.isArray(body.pages) || body.pages.length < 1 || body.pages.length > 500) throw new Error("Worker returned an invalid page list (maximum 500 safety limit).");
      if (typeof body.narration !== "string" || body.narration.length < 30 || body.narration.length > 7000) throw new Error("Worker returned an invalid narration script.");
      const pages = body.pages.map((p: any, i: number) => {
        const u = new URL(String(p.url));
        if (u.protocol !== "https:" || !u.hostname.endsWith(".blob.vercel-storage.com")) throw new Error("Worker returned a non-Vercel page URL.");
        return { url: u.toString(), page: i + 1 };
      });
      await updateJob(id, { status: "script_ready", progress: 0, pages, visualNotes: String(body.visualNotes || "").slice(0, 30000), narration: body.narration, youtubeTitle: String(body.youtubeTitle || "Comic Recap").slice(0, 160), description: String(body.description || "").slice(0, 5000), keywords: Array.isArray(body.keywords) ? body.keywords.map(String).slice(0, 25) : [], hashtags: Array.isArray(body.hashtags) ? body.hashtags.map(String).slice(0, 12) : [], provider: "Ollama · Qwen2.5-VL 3B (local GitHub Actions runner)" });
    } else if (body.status === "failed") {
      await updateJob(id, { status: "failed", error: String(body.error || "Extraction worker failed.").slice(0, 1000) });
    } else {
      await updateJob(id, { status: "extracting", progress: Math.max(0, Math.min(95, Number(body.progress) || 0)) });
    }
    return NextResponse.json({ updated: true });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Worker callback failed." }, { status: 400 }); }
}
