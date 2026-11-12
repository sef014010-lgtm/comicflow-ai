import { jobPath, readPrivateJson, savePrivateJson } from "@/lib/blob";
export type ComicJob = {
  id: string; status: string; createdAt: string; updatedAt: string; format: "shorts" | "landscape";
  sourceUrls: string[]; pages: Array<{ url: string; page: number }>; visualNotes: string;
  narration: string; youtubeTitle: string; description: string; keywords: string[]; hashtags: string[];
  provider: string; voice?: string; audioParts?: Array<{ url: string; index: number; attempts: number }>;
  videoUrl?: string; error?: string; progress?: number; githubRunUrl?: string;
};
export async function readJob(id: string): Promise<ComicJob | null> { return readPrivateJson(jobPath(id)); }
export async function writeJob(job: ComicJob) { job.updatedAt = new Date().toISOString(); await savePrivateJson(jobPath(job.id), job); return job; }
export async function updateJob(id: string, patch: Partial<ComicJob>) {
  const job = await readJob(id);
  if (!job) throw new Error("Job not found.");
  return writeJob({ ...job, ...patch });
}
