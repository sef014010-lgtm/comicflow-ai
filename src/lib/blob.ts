import { put, list } from "@vercel/blob";

const privateToken = () => {
  const token = process.env.BLOB_PRIVATE_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_PRIVATE_READ_WRITE_TOKEN is missing. Connect a Private Vercel Blob store.");
  return token;
};
const publicToken = () => {
  const token = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_PUBLIC_READ_WRITE_TOKEN is missing. Connect a Public Vercel Blob store.");
  return token;
};
export async function savePrivateJson(pathname: string, data: unknown) {
  return put(pathname, JSON.stringify(data), { access: "private", addRandomSuffix: false, allowOverwrite: true, contentType: "application/json", token: privateToken() });
}
export async function readPrivateJson(pathname: string): Promise<any | null> {
  const token = privateToken();
  const result = await list({ prefix: pathname, limit: 10, token });
  const blob = result.blobs.find(item => item.pathname === pathname);
  if (!blob) return null;
  const response = await fetch(blob.url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!response.ok) throw new Error(`Could not read private Blob object (${response.status}).`);
  return response.json();
}
export async function savePublicAsset(pathname: string, data: Buffer | Uint8Array, contentType: string) {
  return put(pathname, data, { access: "public", addRandomSuffix: true, contentType, token: publicToken() });
}
export const SETTINGS_PATH = "comicflow/private/settings.enc.json";
export const jobPath = (id: string) => `comicflow/private/jobs/${id}.json`;
