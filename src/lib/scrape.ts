import * as cheerio from "cheerio";
import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

function isPrivateIPv4(ip: string) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  return p[0] === 10 || p[0] === 127 || p[0] === 0 ||
    (p[0] === 169 && p[1] === 254) ||
    (p[0] === 172 && p[1] >= 16 && p[1] <= 31) ||
    (p[0] === 192 && (p[1] === 168 || p[1] === 0 && p[2] === 0 || p[1] === 0 && p[2] === 2)) ||
    (p[0] === 100 && p[1] >= 64 && p[1] <= 127) ||
    (p[0] === 198 && (p[1] === 18 || p[1] === 19 || p[1] === 51 && p[2] === 100)) ||
    (p[0] === 203 && p[1] === 0 && p[2] === 113) || p[0] >= 224;
}
function isPrivateIPv6(ip: string) {
  const s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  if (s === "::1" || s === "::" || s.startsWith("fc") || s.startsWith("fd") || s.startsWith("fe80:") || s.startsWith("ff")) return true;
  if (s.startsWith("::ffff:")) {
    const mapped = s.slice(7);
    if (mapped.includes(".")) return isPrivateIPv4(mapped);
    const parts = mapped.split(":");
    if (parts.length === 2) {
      const high = parseInt(parts[0], 16), low = parseInt(parts[1], 16);
      if (Number.isFinite(high) && Number.isFinite(low)) return isPrivateIPv4(`${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`);
    }
    return true;
  }
  // Only globally-routable unicast IPv6 (2000::/3) is accepted.
  return !(s.startsWith("2") || s.startsWith("3")) || s.startsWith("2001:db8:");
}
async function readLimited(response: Response, limit: number) {
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new Error("The source response exceeded the allowed size limit.");
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, total);
}
async function validatePublicUrl(raw: string) {
  const url = new URL(raw);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only HTTP and HTTPS source URLs are supported.");
  if (url.username || url.password) throw new Error("URLs containing embedded credentials are not supported.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new Error("Private network addresses are not allowed.");
  if (isIP(host)) {
    if ((isIP(host) === 4 && isPrivateIPv4(host)) || (isIP(host) === 6 && isPrivateIPv6(host))) throw new Error("Private network addresses are not allowed.");
  } else {
    const addresses = await lookup(host, { all: true });
    if (!addresses.length || addresses.some(a => (isIP(a.address) === 4 && isPrivateIPv4(a.address)) || (isIP(a.address) === 6 && isPrivateIPv6(a.address)))) throw new Error("The source host does not resolve to a public address.");
  }
  return url;
}
async function safeFetch(raw: string) {
  let url = await validatePublicUrl(raw);
  for (let i = 0; i <= 3; i++) {
    const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "ComicFlowAI/2.0 (authorized public media fetcher)", Accept: "text/html,image/avif,image/webp,image/apng,image/*,*/*;q=0.8" }, signal: AbortSignal.timeout(20000), cache: "no-store" });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location || i === 3) throw new Error("Too many or invalid redirects from source website.");
      url = await validatePublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Source website returned ${response.status}.`);
    return { response, url };
  }
  throw new Error("Could not safely retrieve the source page.");
}
export async function extractComicImages(inputUrl: string) {
  const { response, url } = await safeFetch(inputUrl);
  const htmlSize = Number(response.headers.get("content-length") || 0);
  if (htmlSize > 12 * 1024 * 1024) throw new Error("Source HTML is too large to process safely.");
  const htmlBytes = await readLimited(response, 12 * 1024 * 1024);
  const html = new TextDecoder().decode(htmlBytes);
  const $ = cheerio.load(html);
  const found = new Set<string>();
  const attrs = ["data-src", "data-lazy-src", "data-original", "data-url", "src"];
  $("img").each((_, element) => {
    for (const attr of attrs) {
      const raw = $(element).attr(attr);
      if (!raw || raw.startsWith("data:") || raw.startsWith("blob:")) continue;
      try {
        const absolute = new URL(raw, url).toString();
        if (/\.(png|jpe?g|webp|avif)(?:[?#]|$)/i.test(absolute) || /chapter|page|comic|manga|manhwa|image/i.test(absolute)) found.add(absolute);
        break;
      } catch {}
    }
  });
  const og = $("meta[property='og:image'],meta[name='twitter:image']").map((_, el) => $(el).attr("content")).get();
  for (const raw of og) if (raw) { try { found.add(new URL(raw, url).toString()); } catch {} }
  const output: string[] = [];
  for (const candidate of found) {
    try { await validatePublicUrl(candidate); output.push(candidate); } catch {}
    if (output.length >= 30) break;
  }
  if (!output.length) throw new Error("No usable page images were found. The source may require JavaScript, login, or a site-specific integration.");
  return output;
}
export async function downloadPageImage(url: string) {
  const { response } = await safeFetch(url);
  if (!response.ok) throw new Error(`Could not download a page image (${response.status}).`);
  const type = response.headers.get("content-type") || "";
  if (!type.startsWith("image/")) throw new Error("A discovered page URL did not return an image.");
  const announced = Number(response.headers.get("content-length") || 0);
  if (announced > 12 * 1024 * 1024) throw new Error("A page image exceeds the 12 MB per-image limit.");
  const bytes = await readLimited(response, 12 * 1024 * 1024);
  if (bytes.length < 1000) throw new Error("A page image is empty or exceeds the 12 MB per-image limit.");
  return { bytes, type: type.split(";")[0] };
}
