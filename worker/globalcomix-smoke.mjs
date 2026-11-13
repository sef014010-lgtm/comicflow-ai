import { chromium } from 'playwright';
const target = 'https://share.google/1LaX0LuwnfFmkoa3F';
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 1365, height: 900 } });
  await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const host = new URL(page.url()).hostname.toLowerCase();
  const title = await page.title();
  console.log(JSON.stringify({ requestedUrl: target, resolvedUrl: page.url(), host, title }, null, 2));
  if (!(host === 'globalcomix.com' || host.endsWith('.globalcomix.com'))) throw new Error('The shared URL did not resolve directly to GlobalComix.');
  for (let i = 0; i < 16; i++) {
    await page.locator('img').evaluateAll(nodes => nodes.map(img => ({ w: img.naturalWidth, h: img.naturalHeight })));
    await page.evaluate(() => window.scrollBy(0, Math.max(600, window.innerHeight * 0.8)));
    await page.waitForTimeout(400);
  }
  const images = await page.locator('img').evaluateAll(nodes => nodes.map(img => ({ src: img.currentSrc || img.src, width: img.naturalWidth, height: img.naturalHeight, alt: img.alt || '' })).filter(x => x.src && x.width >= 450 && x.height >= 350));
  console.log(JSON.stringify({ candidateFullPageImages: images.length, sample: images.slice(0, 4).map(x => ({ width: x.width, height: x.height, alt: x.alt })) }, null, 2));
  if (!images.length) throw new Error('No complete public page images were detected; no access restriction was bypassed.');
} finally { await browser.close(); }
