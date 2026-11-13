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
  console.log(`Sending page ${pageNumber} to ${MODEL} (${Math.round(image.length / 1024)} KB)...`);
  const r = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt: `Analyze comic page ${pageNumber}. Record the visible characters, actions, expressions, setting, important objects, and readable dialogue. Keep the events in this page only; do not invent names or events. Return 1-3 concise factual sentences.`,
      images: [image],
      stream: false,
      options: { temperature: 0.1, num_ctx: 4096, num_predict: 150 },
      keep_alive: '10m'
    }),
    signal: AbortSignal.timeout(900000)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Local Ollama vision failed for page ${pageNumber}.`);
  const note = String(d.response || '').trim();
  if (!note) throw new Error(`Local Ollama returned no vision notes for page ${pageNumber}.`);
  console.log(`Vision complete for page ${pageNumber}.`);
  return note.slice(0, 500);
}

async function summarizeChunk(chunk, firstPage, lastPage, tone) {
  const prompt = `Summarize these sequential comic page observations into a compact, chronological story segment. Preserve all important events, character actions, revelations, and dialogue context. Do not invent facts. Tone preference: ${tone}. Return plain text, maximum 450 words.\n\n${chunk.map((n, i) => `PAGE ${firstPage + i}: ${n}`).join('\n')}`;
  const r = await fetch('http://127.0.0.1:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL, prompt, stream: false,
      options: { temperature: 0.2, num_ctx: 8192, num_predict: 650 },
      keep_alive: '10m'
    }),
    signal: AbortSignal.timeout(900000)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || `Failed summarizing pages ${firstPage}-${lastPage}.`);
  if (!String(d.response || '').trim()) throw new Error(`Empty summary for pages ${firstPage}-${lastPage}.`);
  return String(d.response).trim();
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

    // Keep scrolling until the reader reaches the bottom and no new page images appear.
    // There is deliberately no fixed page-count limit.
    let stagnantPasses = 0;
    let previousCount = -1;
    while (stagnantPasses < 8) {
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

      if (found.size === previousCount) stagnantPasses++;
      else stagnantPasses = 0;
      previousCount = found.size;

      const state = await page.evaluate(() => ({
        atBottom: window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 80,
        height: document.documentElement.scrollHeight
      }));
      await page.evaluate(() => window.scrollBy(0, Math.max(600, window.innerHeight * 0.75)));
      await page.waitForTimeout(state.atBottom ? 1200 : 700);
      if (state.atBottom && stagnantPasses >= 3) break;
    }
  }

  const imageUrls = [...found.keys()];
  if (!imageUrls.length) {
    throw new Error('Playwright found no complete page images. The chapter may be gated or use a reader layout needing a site-specific selector.');
  }
  console.log(`Playwright found ${imageUrls.length} unique candidate page images. No page-count cap is applied.`);
  await callback({ status: 'extracting', progress: 25 });

  const pages = [];
  const notes = [];
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
      `comicflow/jobs/${jobId}/pages/page-${String(i + 1).padStart(4, '0')}.${ext}`,
      bytes,
      { access: 'public', addRandomSuffix: true, contentType: type, token: blobToken }
    );
    pages.push({ url: asset.url, page: i + 1 });
    console.log(`Saved original page image ${i + 1}/${imageUrls.length} for final rendering.`);

    // Analyze each page individually to keep memory and model context bounded.
    const note = await vision(page, i + 1, bytes, type);
    notes.push(note);
    await callback({
      status: 'extracting',
      progress: 25 + Math.round((i + 1) / imageUrls.length * 45)
    });
  }

  // Hierarchical summarization prevents long chapters from overflowing the model context.
  const storySegments = [];
  for (let offset = 0; offset < notes.length; offset += 8) {
    const chunk = notes.slice(offset, offset + 8);
    storySegments.push(await summarizeChunk(
      chunk, offset + 1, offset + chunk.length, job.tone
    ));
  }

  const prompt = `Write an original truthful YouTube comic recap in American English based on the complete chronological story segments below. Every page of the chapter was analyzed. Preserve chronology and important events; do not invent names, dialogue, or events. Tone: ${job.tone}. Length: ${job.format === 'shorts' ? '110-145 words' : '420-650 words'}. Return valid JSON with narration, youtubeTitle, description, keywords array, hashtags array. STORY SEGMENTS:\\n${storySegments.map((s, i) => `SEGMENT ${i + 1}: ${s}`).join('\\n\\n')}`;
  await callback({ status: 'extracting', progress: 78 });
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
  console.log(`Success: saved and analyzed all ${pages.length} discovered chapter pages; generated recap script locally with Ollama.`);
} catch (e) {
  const message = e instanceof Error ? e.message : String(e);
  console.error('ComicFlow worker failed:', message);
  await callback({ status: 'failed', error: message }).catch(err => console.error('Failure callback:', err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
}
