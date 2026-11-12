import crypto from "node:crypto";

function secretKey() {
  const raw = process.env.ENCRYPTION_SECRET || "";
  if (!/^[a-fA-F0-9]{64}$/.test(raw)) throw new Error("ENCRYPTION_SECRET must be 64 hexadecimal characters (32 bytes).");
  return Buffer.from(raw, "hex");
}
export function encryptText(value: string) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map(x => x.toString("base64")).join(".");
}
export function decryptText(value: string) {
  const [iv, tag, data] = value.split(".");
  if (!iv || !tag || !data) throw new Error("Encrypted settings are invalid.");
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}
function safeEqual(a: string, b: string) {
  const aa = Buffer.from(a), bb = Buffer.from(b);
  return aa.length === bb.length && crypto.timingSafeEqual(aa, bb);
}
export function requireAppPassword(request: Request) {
  const expected = process.env.APP_PASSWORD || "";
  if (!expected) throw new Error("APP_PASSWORD is not configured.");
  if (!safeEqual(expected, request.headers.get("x-app-password") || "")) throw new Error("Unauthorized. Enter your dashboard password.");
}
export function requireWorkerSecret(request: Request) {
  const expected = process.env.WORKER_SECRET || "";
  if (!expected) throw new Error("WORKER_SECRET is not configured.");
  const header = request.headers.get("authorization") || "";
  if (!safeEqual(`Bearer ${expected}`, header)) throw new Error("Worker unauthorized.");
}
