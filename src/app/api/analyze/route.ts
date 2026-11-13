import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { requireAppPassword } from "@/lib/security";
import { writeJob, updateJob } from "@/lib/jobs";
export const runtime = "nodejs";
export const maxDuration = 30;
export async function POST(request: Request) {
  try {
    requireAppPassword(request);
    const body = await request.json();
    const urls: string[] = Array.isArray(body.urls) ? body.urls.map((v: unknown) => String(v).trim()).filter(Boolean) : [];
    const format = body.format === "landscape" ? "landscape" : "shorts";
    const tone = String(body.tone || "cinematic, engaging and suspenseful").slice(0, 120);
    if (!urls.length || urls.length > 3) return NextResponse.json({ error: "Enter between 1 and 3 chapter URLs." }, { status: 400 });
    if (urls.some(url => url.length > 2048 || !/^https?:\/\//i.test(url))) return NextResponse.json({ error: "Each chapter must be a valid HTTP or HTTPS URL under 2,048 characters." }, { status: 400 });
    const owner = process.env.GITHUB_OWNER, repo = process.env.GITHUB_REPO, token = process.env.GITHUB_TOKEN;
    if (!owner || !repo || !token) throw new Error("GitHub Actions is not configured. Add GITHUB_OWNER, GITHUB_REPO, and a fine-grained GITHUB_TOKEN with Actions: write permission in Vercel.");
    const id = crypto.randomUUID(), now = new Date().toISOString();
    await writeJob({ id, status: "extracting", createdAt: now, updatedAt: now, format, tone, sourceUrls: urls, pages: [], visualNotes: "", narration: "", youtubeTitle: "Processing chapter...", description: "", keywords: [], hashtags: [], provider: "Pending Playwright + local Qwen worker", progress: 1 } as any);
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/actions/workflows/extract-chapter.yml/dispatches`, {
      method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json" },
      body: JSON.stringify({ ref: process.env.GITHUB_WORKFLOW_REF || "main", inputs: { job_id: id } }), cache: "no-store", signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 400);
      await updateJob(id, { status: "failed", error: `GitHub could not start extraction (${response.status}): ${detail}` });
      throw new Error(`GitHub could not start the Playwright worker (${response.status}). Check GITHUB_TOKEN Actions: write permission and GITHUB_WORKFLOW_REF.`);
    }
    return NextResponse.json({ id, status: "extracting", format, sourceUrls: urls, pages: [], narration: "", youtubeTitle: "Processing chapter...", description: "", keywords: [], hashtags: [], provider: "Playwright + local Qwen worker", progress: 1 });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Could not start chapter extraction." }, { status: 400 }); }
}
