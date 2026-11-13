import { chromium } from 'playwright';
import { put } from '@vercel/blob';

const api = process.env.COMICFLOW_API_URL?.replace(/\/$/, '');
const secret = process.env.COMICFLOW_WORKER_SECRET;
const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN;
const jobId = process.env.JOB_ID;

if (!api || !secret || !blobToken || !jobId) {
  throw new Error('Missing worker environment configuration.');
}

const headers = { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' };
const MODEL = 'qwen2.5vl:3b';
const MAX_PAGES = 6;

async function callback(payload) {
  const r = await fetch(`${api}/api/worker/job/${jobId}`, {
    method: 'POST', headers, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw new Error(`Worker callback failed (${r.status}): ${(await r.text()).slice(0, 300)}`);
}

async function ollama(prompt) {
  console.log('Generating recap script with local Ollama...');
  const r = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, stream: false, format: 'json',
      options: { temperature: 0.35, num_ctx: 8192, num_predict: 1200 },
      keep_alive: '10m'
    }),
    signal: AbortSignal.timeout(900000)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Local Ollama script generation failed.');
  return d.response || '';
}

async function resizeForVision(page, bytes, contentType) {
  const dataUrl = `data:${contentType};base64,${bytes.toString('base64')}`;
  return page.evaluate(async (src) => {
    const img = new Image();
    img.src = src;
    await img.decode();
    const maxWidth = 768;
    const maxHeight = 1024;
    const scale = Math.min(1, maxWidth / img.naturalWidth, maxHeight / img.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.72).split(',')[1];
  }, dataUrl);
}

async function vision(page, pageNumber, bytes, contentType) {
  console.log(`Preparing page ${pageNumber} for vision analysis...`);
  const image = await resizeForVision(page, bytes, contentType);
  console.log(`Sending resized page ${pageNumber} to ${MODEL} (${Math.round(image.length / 1024)} KB)...`);
  const r = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `Analyze comic page ${pageNumber}. Describe only visible characters, actions, expressions, setting, objects, and readable dialogue. Do not invent names or events. Return concise factual notes in 2-4 sentences.`,
      images: [image],
      stream: false,
      options: { temperature: 0.1, num_ctx: 4096, num_predict: 120 },
      keep_alive: '10m'
    }),
    signal: AbortSignal.timeout(900000)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Local Ollama vision failed for page ${pageNumber}.`);
  const note = String(d.response || '').trim();
  if (!note) throw new Error(`Local Ollama returned no vision notes for page ${pageNumber}.`);
  console.log(`Vision complete for page ${pageNumber}.`);
  return note.slice(0, 700);
}

let browser;
try {
  const r = await fetch(`${api}/api/worker/job/${jobId}`, {
    headers: { Authorization: `Bearer ${secret}` }, cache: 'no-store', signal: AbortSignal.timeout(30000)
  });
  if (!r.ok) throw new Error(`Could not load extraction job (${r.status}): ${(await r.text()).slice(0, 300)}`);
  const job = await r.json();
  if (!Array.isArray(job.sourceUrls) || !job.sourceUrls.length || job.sourceUrls.length > 3) {
    throw new Error('Invalid source URL list.');
  }

  browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  page.setDefaultNavigationTimeout(60000);
  const found = new Map();

  for (const source of job.sourceUrls) {
    console.log(`Opening authorized chapter: ${source}`);
    await page.goto(source, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);
    const host = new URL(page.url()).hostname.toLowerCase();
    if (!(host === 'globalcomix.com' || host.endsWith('.globalcomix.com'))) {
      throw new Error(`Shared link resolved to ${host}, not GlobalComix. Use the direct chapter URL.`);
    }
    const title = await page.title();
    if (/sign in|subscribe|purchase|unlock chapter/i.test(title)) {
      throw new Error('Chapter appears gated by sign-in or purchase; access restrictions will not be bypassed.');
    }

    for (let pass = 0; pass < 14; pass++) {
      const imgs = await page.locator('img').evaluateAll(nodes => nodes.map(img => ({
        src: img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || '',
        w: img.naturalWidth || img.width || 0,
        h: img.naturalHeight || img.height || 0,
        alt: img.alt || '',
        visible: !!(img.offsetWidth || img.offsetHeight || img.getClientRects().length)
      })));
      for (const im of imgs) {
        if (!im.src || !im.visible || im.w < 450 || im.h < 350 ||
            /logo|avatar|icon|profile|banner|cover|thumbnail|spinner|loading/i.test(im.alt + ' ' + im.src)) continue;
        try {
          const u = new URL(im.src, page.url());
          if (u.protocol === 'https:') found.set(u.href, u.href);
        } catch {}
      }
      if (found.size >= MAX_PAGES) break;
      await page.evaluate(() => window.scrollBy(0, Math.max(600, window.innerHeight * 0.8)));
      await page.waitForTimeout(450);
    }
    if (found.size >= MAX_PAGES) break;
  }

  const imageUrls = [...found.keys()].slice(0, MAX_PAGES);
  if (!imageUrls.length) {
    throw new Error('Playwright found no complete page images. The chapter may be gated or use a reader layout needing a site-specific selector.');
  }
  console.log(`Playwright found ${found.size} candidate images; processing ${imageUrls.length} pages.`);
  await callback({ status: 'extracting', progress: 25 });

  const pages = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const response = await page.request.get(imageUrls[i], { timeout: 45000 });
    if (!response.ok()) throw new Error(`Page image ${i + 1} download failed (${response.status()}).`);
    const type = response.headers()['content-type']?.split(';')[0] || '';
    if (!type.startsWith('image/')) throw new Error(`Page ${i + 1} did not return an image.`);
    const bytes = await response.body();
    if (bytes.length < 1000 || bytes.length > 12 * 1024 * 1024) {
      throw new Error(`Page ${i + 1} is empty or exceeds 12 MB.`);
    }
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('avif') ? 'avif' : 'jpg';
    const asset = await put(
      `comicflow/jobs/${jobId}/pages/page-${String(i + 1).padStart(3, '0')}.${ext}`,
      bytes,
      { access: 'public', addRandomSuffix: true, contentType: type, token: blobToken }
    );
    pages.push({ url: asset.url, page: i + 1, bytes, contentType: type });
    await callback({ status: 'extracting', progress: 25 + Math.round((i + 1) / imageUrls.length * 20) });
  }

  const notes = [];
  for (let i = 0; i < pages.length; i++) {
    const note = await vision(page, i + 1, pages[i].bytes, pages[i].contentType);
    notes.push(note);
    await callback({ status: 'extracting', progress: 45 + Math.round((i + 1) / pages.length * 20) });
  }

  const prompt = `Write an original truthful YouTube comic recap in American English based only on these visible page notes. Preserve chronology; do not invent names or events. Tone: ${job.tone}. Length: ${job.format === 'shorts' ? '110-145 words' : '420-650 words'}. Return JSON with narration, youtubeTitle, description, keywords array, hashtags array. PAGE NOTES:\n${notes.map((n, i) => `PAGE ${i + 1}: ${n}`).join('\n\n')}`;
  await callback({ status: 'extracting', progress: 65 });
  const result = JSON.parse(await ollama(prompt));
  if (typeof result.narration !== 'string' || result.narration.trim().length < 30) {
    throw new Error('Local Qwen did not return a usable narration.');
  }

  await callback({
    status: 'script_ready',
    pages: pages.map(({ url, page }) => ({ url, page })),
    visualNotes: notes.join('\n\n'),
    narration: result.narration.slice(0, 7000),
    youtubeTitle: String(result.youtubeTitle || 'Comic Recap').slice(0, 160),
    description: String(result.description || '').slice(0, 5000),
    keywords: Array.isArray(result.keywords) ? result.keywords.slice(0, 25) : [],
    hashtags: Array.isArray(result.hashtags) ? result.hashtags.slice(0, 12) : []
  });
  console.log(`Success: extracted and analyzed ${pages.length} pages; generated recap script locally with Ollama.`);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error('ComicFlow worker failed:', message);
  await callback({ status: 'failed', error: message }).catch(err => console.error('Failure callback:', err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
