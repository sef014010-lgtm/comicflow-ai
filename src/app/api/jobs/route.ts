import { NextResponse } from "next/server";
import { list } from "@vercel/blob";
import { requireAppPassword } from "@/lib/security";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAppPassword(request);
    const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
    if (!token) throw new Error("BLOB_PRIVATE_READ_WRITE_TOKEN is missing.");
    const result = await list({ prefix: "comicflow/private/jobs/", limit: 50, token });
    const jobs: any[] = [];
    for (const item of result.blobs.filter((b: { pathname: string }) => b.pathname.endsWith(".json")).slice(0, 25)) {
      try {
        const response = await fetch(item.url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (response.ok) jobs.push(await response.json());
      } catch {}
    }
    jobs.sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    return NextResponse.json({ jobs });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 401 }); }
}
