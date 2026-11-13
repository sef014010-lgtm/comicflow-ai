import { NextResponse } from "next/server";
import { requireAppPassword } from "@/lib/security";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAppPassword(request);
    const checks = {
      appPassword: Boolean(process.env.APP_PASSWORD),
      encryptionSecret: /^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_SECRET || ""),
      privateBlobToken: Boolean(process.env.BLOB_PRIVATE_READ_WRITE_TOKEN),
      publicBlobToken: Boolean(process.env.BLOB_PUBLIC_READ_WRITE_TOKEN),
      workerSecret: Boolean(process.env.WORKER_SECRET),
      githubOwner: Boolean(process.env.GITHUB_OWNER),
      githubRepo: Boolean(process.env.GITHUB_REPO),
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      localOllamaVision: true,
      localOllamaText: true
    };
    return NextResponse.json({ checks, readyForExtraction: checks.privateBlobToken && checks.publicBlobToken && checks.workerSecret && checks.githubOwner && checks.githubRepo && checks.githubToken, readyForRender: checks.publicBlobToken && checks.workerSecret && checks.githubOwner && checks.githubRepo && checks.githubToken });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Diagnostics failed." }, { status: 401 }); }
}
