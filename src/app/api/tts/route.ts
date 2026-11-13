import { NextResponse } from "next/server";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { EdgeTTS } from "node-edge-tts";
import { requireAppPassword } from "@/lib/security";
import { savePublicAsset } from "@/lib/blob";
import { readJob, updateJob } from "@/lib/jobs";
export const runtime = "nodejs";
export const maxDuration = 300;
function splitText(text: string, limit = 2600) {
  const sentences = text.replace(/\r/g, "").split(/(?<=[.!?])\s+/);
  const chunks: string[] = []; let current = "";
  for (const sentence of sentences) {
    if ((current + " " + sentence).trim().length > limit && current) { chunks.push(current.trim()); current = sentence.trim(); }
    else current = (current + " " + sentence).trim();
  }
  if (current) chunks.push(current);
  return chunks;
}
export async function POST(request: Request) {
  let dir = "";
  try {
    requireAppPassword(request);
    const { jobId, text, voice = "en-US-AriaNeural", rate = "+0%" } = await request.json();
    if (typeof jobId !== "string" || !/^[0-9a-f-]{8}-[0-9a-f-]{4}-[1-5][0-9a-f-]{3}-[89ab][0-9a-f-]{3}-[0-9a-f-]{12}$/i.test(jobId)) throw new Error("Invalid job ID.");
    if (typeof text !== "string" || text.trim().length < 30 || text.length > 7000) throw new Error("Narration must contain 30 to 7,000 characters.");
    const allowedVoices = new Set(["en-US-AriaNeural", "en-US-GuyNeural", "en-US-JennyNeural", "en-US-ChristopherNeural", "en-US-EricNeural"]);
    if (!allowedVoices.has(voice)) throw new Error("Choose one of the supported US English voices.");
    if (!/^[+-](0|5|10)%$/.test(rate)) throw new Error("Unsupported narration rate.");
    const existingJob = await readJob(jobId);
    if (!existingJob) throw new Error("Job not found.");
    if (["queued", "rendering", "complete"].includes(existingJob.status)) throw new Error("This job cannot regenerate narration while rendering or after completion. Create a new job to make a separate version.");
    const chunks = splitText(text);
    if (chunks.length > 3) throw new Error("This narration is too long for one synthesis request. Shorten it first.");
    dir = await mkdtemp(path.join(tmpdir(), "comicflow-tts-"));
    const parts: Array<{ url: string; index: number; attempts: number }> = [];
    for (let i = 0; i < chunks.length; i++) {
      let done = false, lastError = "Unknown TTS error";
      for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        const output = path.join(dir, `voice-${i + 1}.mp3`);
        try {
          const { unlink } = await import("node:fs/promises");
          await unlink(output).catch(() => {});
          const tts = new EdgeTTS({ voice, lang: "en-US", outputFormat: "audio-24khz-96kbitrate-mono-mp3", rate, timeout: 25000 });
          await tts.ttsPromise(chunks[i], output);
          const audio = await readFile(output);
          if (audio.length < 1000) throw new Error("TTS returned an empty audio segment.");
          const asset = await savePublicAsset(`comicflow/jobs/${jobId}/audio/part-${i + 1}.mp3`, audio, "audio/mpeg");
          parts.push({ url: asset.url, index: i + 1, attempts: attempt }); done = true;
        } catch (e: any) { lastError = e.message || String(e); if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 900)); }
      }
      if (!done) throw new Error(`Edge TTS failed on segment ${i + 1} after 3 attempts: ${lastError}`);
    }
    await updateJob(jobId, { narration: text, voice, audioParts: parts, status: "audio_ready", progress: 0, videoUrl: undefined, error: undefined });
    return NextResponse.json({ jobId, voice, parts, totalParts: parts.length, retryPolicy: "Up to 3 attempts per segment" });
  } catch (e: any) { return NextResponse.json({ error: e.message || "TTS failed." }, { status: 400 }); }
  finally { if (dir) await rm(dir, { recursive: true, force: true }).catch(() => {}); }
}
