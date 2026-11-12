import { NextResponse } from "next/server";
import { requireAppPassword } from "@/lib/security";
import { readJob } from "@/lib/jobs";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    requireAppPassword(request);
    const { id } = await context.params;
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) return NextResponse.json({ error: "Invalid job ID." }, { status: 400 });
    const job = await readJob(id);
    if (!job) return NextResponse.json({ error: "Job not found." }, { status: 404 });
    return NextResponse.json(job);
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 401 }); }
}
