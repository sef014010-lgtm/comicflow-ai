import { NextResponse } from "next/server";
import { requireAppPassword } from "@/lib/security";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAppPassword(request);
    return NextResponse.json({ saved: { localVision: true, localText: true }, engine: "Ollama · Qwen2.5-VL 3B" });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 401 }); }
}
export async function POST(request: Request) {
  try {
    requireAppPassword(request);
    return NextResponse.json({ error: "No external AI keys are required. ComicFlow uses local Ollama models." }, { status: 410 });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 401 }); }
}
