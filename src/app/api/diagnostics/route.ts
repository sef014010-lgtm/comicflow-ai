import { NextResponse } from "next/server";
import { requireAppPassword } from "@/lib/security";
import { readPrivateJson, SETTINGS_PATH } from "@/lib/blob";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAppPassword(request);
    const stored = await readPrivateJson(SETTINGS_PATH);
    const keys = stored?.encrypted ? JSON.parse((await import("@/lib/security")).decryptText(stored.encrypted)) : {};
    const checks = {
      appPassword: Boolean(process.env.APP_PASSWORD),
      encryptionSecret: /^[a-f0-9]{64}$/i.test(process.env.ENCRYPTION_SECRET || ""),
      privateBlobToken: Boolean(process.env.BLOB_PRIVATE_READ_WRITE_TOKEN),
      publicBlobToken: Boolean(process.env.BLOB_PUBLIC_READ_WRITE_TOKEN),
      workerSecret: Boolean(process.env.WORKER_SECRET),
      githubOwner: Boolean(process.env.GITHUB_OWNER),
      githubRepo: Boolean(process.env.GITHUB_REPO),
      githubToken: Boolean(process.env.GITHUB_TOKEN),
      groqKeySaved: Boolean(keys.groq),
      togetherKeySaved: Boolean(keys.together),
      cerebrasKeySaved: Boolean(keys.cerebras)
    };
    return NextResponse.json({ checks, readyForExtraction: checks.privateBlobToken && checks.publicBlobToken && checks.workerSecret && checks.githubOwner && checks.githubRepo && checks.githubToken && checks.groqKeySaved, readyForRender: checks.publicBlobToken && checks.workerSecret && checks.githubOwner && checks.githubRepo && checks.githubToken });
  } catch (e: any) { return NextResponse.json({ error: e.message || "Diagnostics failed." }, { status: 401 }); }
}
