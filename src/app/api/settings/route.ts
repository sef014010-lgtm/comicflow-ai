import { NextResponse } from "next/server";
import { decryptText, encryptText, requireAppPassword } from "@/lib/security";
import { readPrivateJson, savePrivateJson, SETTINGS_PATH } from "@/lib/blob";
export const runtime = "nodejs";
export async function GET(request: Request) {
  try {
    requireAppPassword(request);
    const stored = await readPrivateJson(SETTINGS_PATH);
    const keys = stored?.encrypted ? JSON.parse(decryptText(stored.encrypted)) : {};
    return NextResponse.json({ saved: { groq: Boolean(keys.groq), together: Boolean(keys.together), cerebras: Boolean(keys.cerebras) } });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 401 }); }
}
export async function POST(request: Request) {
  try {
    requireAppPassword(request);
    const body = await request.json();
    const old = await readPrivateJson(SETTINGS_PATH);
    const previous = old?.encrypted ? JSON.parse(decryptText(old.encrypted)) : {};
    const keys = {
      groq: typeof body.groq === "string" && body.groq.trim() ? body.groq.trim() : previous.groq || "",
      together: typeof body.together === "string" && body.together.trim() ? body.together.trim() : previous.together || "",
      cerebras: typeof body.cerebras === "string" && body.cerebras.trim() ? body.cerebras.trim() : previous.cerebras || ""
    };
    if (!keys.groq) return NextResponse.json({ error: "Groq API key is required." }, { status: 400 });
    await savePrivateJson(SETTINGS_PATH, { encrypted: encryptText(JSON.stringify(keys)), updatedAt: new Date().toISOString() });
    return NextResponse.json({ saved: true });
  } catch (e: any) { return NextResponse.json({ error: e.message }, { status: 400 }); }
}
