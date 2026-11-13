import { NextResponse } from "next/server";
import { requireAppPassword } from "@/lib/security";
import { readJob, updateJob } from "@/lib/jobs";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    requireAppPassword(request);
    const { jobId } = await request.json();
    if (typeof jobId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(jobId)) throw new Error("Invalid job ID.");
    const job = await readJob(jobId);
    if (!job) throw new Error("Job not found.");
    if (job.status === "queued" || job.status === "rendering") {
      const age = Date.now() - new Date(job.updatedAt).getTime();
      if (Number.isFinite(age) && age < 45 * 60 * 1000) return NextResponse.json({ queued: true, jobId, alreadyQueued: true });
    }
    if (job.status === "complete" && job.videoUrl) throw new Error("This job already has a completed video. Create a new job if you want another export.");
    if (!job.pages?.length || !job.audioParts?.length || job.audioParts.length > 3) throw new Error("This job has an invalid page or audio manifest. Re-run analysis and narration (maximum 500 pages per render).");
    const owner = process.env.GITHUB_OWNER, repo = process.env.GITHUB_REPO, token = process.env.GITHUB_TOKEN;
    if (!owner || !repo || !token) throw new Error("GitHub Actions is not configured. Add GITHUB_OWNER, GITHUB_REPO, and GITHUB_TOKEN in Vercel.");
    await updateJob(jobId, { status: "queued", progress: 0, error: undefined, videoUrl: undefined });
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/render-video.yml/dispatches`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: process.env.GITHUB_WORKFLOW_REF || "main", inputs: { job_id: jobId } }), cache: "no-store"
    });
    if (!response.ok) {
      const detail = await response.text();
      await updateJob(jobId, { status: "failed", error: `GitHub could not start the render workflow (${response.status}): ${detail.slice(0, 500)}` });
      throw new Error(`GitHub could not start the render workflow (${response.status}). Check the fine-grained token has Actions: write permission.`);
    }
    return NextResponse.json({ queued: true, jobId });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Could not queue render." }, { status: 400 }); }
}
