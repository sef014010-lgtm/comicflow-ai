import { NextResponse } from "next/server";
import { requireWorkerSecret } from "@/lib/security";
import { readJob, updateJob } from "@/lib/jobs";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireWorkerSecret(request);
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
    const job = await readJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    if (!["queued", "rendering"].includes(job.status)) return NextResponse.json({ error: `Job is not renderable from status ${job.status}.` }, { status: 409 });
    await updateJob(id, { status: "rendering", progress: Math.max(5, job.progress || 0) });
    return NextResponse.json({ id: job.id, format: job.format, pages: job.pages, audioParts: job.audioParts, youtubeTitle: job.youtubeTitle });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 401 }); }
}
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireWorkerSecret(request);
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
    const body = await request.json();
    const status = body.status === "complete" ? "complete" : body.status === "rendering" ? "rendering" : "failed";
    const patch: any = { status, progress: status === "complete" ? 100 : Math.max(0, Math.min(99, Number(body.progress) || 0)) };
    if (status === "complete" && typeof body.videoUrl === "string") {
      const videoUrl = new URL(body.videoUrl);
      if (videoUrl.protocol !== "https:" || !videoUrl.hostname.endsWith(".blob.vercel-storage.com")) return NextResponse.json({ error: "Worker returned an invalid video URL." }, { status: 400 });
      patch.videoUrl = videoUrl.toString();
    }
    else if (status === "failed") patch.error = String(body.error || "Render worker failed.").slice(0, 1000);
    await updateJob(id, patch);
    return NextResponse.json({ updated: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 401 }); }
}
