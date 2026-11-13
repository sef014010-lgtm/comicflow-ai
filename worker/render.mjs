import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { put } from '@vercel/blob';

const run = (cmd, args, opts = {}) => new Promise((resolve, reject) => {
  const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], ...opts });
  let stdout = '', stderr = '';
  child.stdout.on('data', d => stdout += d.toString());
  child.stderr.on('data', d => stderr += d.toString());
  child.on('error', reject);
  child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`${cmd} exited ${code}: ${stderr.slice(-2500)}`)));
});
const api = process.env.COMICFLOW_API_URL?.replace(/\/$/, '');
const workerSecret = process.env.COMICFLOW_WORKER_SECRET;
const blobToken = process.env.BLOB_PUBLIC_READ_WRITE_TOKEN;
const jobId = process.env.JOB_ID;
if (!api || !workerSecret || !blobToken || !jobId) throw new Error('Missing worker environment configuration.');
const headers = { Authorization: `Bearer ${workerSecret}`, 'Content-Type': 'application/json' };
async function callback(payload) {
  const res = await fetch(`${api}/api/worker/job/${jobId}`, { method: 'POST', headers, body: JSON.stringify(payload) });
  if (!res.ok) throw new Error(`Could not update job status (${res.status}): ${(await res.text()).slice(0, 500)}`);
}
async function download(url, destination, maxBytes = 40 * 1024 * 1024) {
  const response = await fetch(url, { signal: AbortSignal.timeout(90000) });
  if (!response.ok) throw new Error(`Asset download failed (${response.status}).`);
  const type = response.headers.get('content-type') || '';
  if (!type.startsWith('image/') && !type.startsWith('audio/')) throw new Error('Unexpected media content type.');
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxBytes) throw new Error('Asset is empty or larger than the configured download limit.');
  await writeFile(destination, bytes);
}
let temp = '';
try {
  const response = await fetch(`${api}/api/worker/job/${jobId}`, { headers: { Authorization: `Bearer ${workerSecret}` }, cache: 'no-store' });
  if (!response.ok) throw new Error(`Could not claim job (${response.status}): ${(await response.text()).slice(0, 500)}`);
  const job = await response.json();
  if (!Array.isArray(job.pages) || !job.pages.length) throw new Error('Job has an invalid or empty page list.');
  if (!Array.isArray(job.audioParts) || !job.audioParts.length || job.audioParts.length > 3) throw new Error('Job has an invalid audio list (maximum 3).');
  temp = await mkdtemp(path.join(tmpdir(), 'comicflow-render-'));
  const width = job.format === 'landscape' ? 1920 : 1080;
  const height = job.format === 'landscape' ? 1080 : 1920;
  const pageFiles = [];
  for (let i = 0; i < job.pages.length; i++) {
    const response = await fetch(job.pages[i].url, { signal: AbortSignal.timeout(90000) });
    if (!response.ok) throw new Error(`Page ${i + 1} download failed (${response.status}).`);
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    if (!contentType.startsWith('image/')) throw new Error(`Page ${i + 1} did not return an image.`);
    const extension = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : contentType.includes('avif') ? 'avif' : 'jpg';
    const filename = path.join(temp, `page-${String(i).padStart(3, '0')}.${extension}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!bytes.length || bytes.length > 12 * 1024 * 1024) throw new Error(`Page ${i + 1} is empty or exceeds 12 MB.`);
    await writeFile(filename, bytes);
    pageFiles.push(filename);
    await callback({ status: 'rendering', progress: Math.min(15, 5 + Math.round((i + 1) / job.pages.length * 10)) });
  }
  const audioFiles = [];
  for (let i = 0; i < job.audioParts.length; i++) {
    const filename = path.join(temp, `audio-${String(i).padStart(2, '0')}.mp3`);
    await download(job.audioParts[i].url, filename, 20 * 1024 * 1024);
    audioFiles.push(filename);
  }
  const audioList = audioFiles.map(file => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n';
  await writeFile(path.join(temp, 'audio-list.txt'), audioList);
  const narration = path.join(temp, 'narration.mp3');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(temp, 'audio-list.txt'), '-c:a', 'libmp3lame', '-q:a', '3', narration]);
  const probe = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', narration]);
  const totalDuration = Number(probe.stdout.trim());
  if (!Number.isFinite(totalDuration) || totalDuration < 1 || totalDuration > 900) throw new Error('Narration duration must be between 1 second and 15 minutes.');
  const perPage = totalDuration / pageFiles.length;
  const clips = [];
  for (let i = 0; i < pageFiles.length; i++) {
    const output = path.join(temp, `clip-${String(i).padStart(3, '0')}.mp4`);
    const duration = perPage + (i === pageFiles.length - 1 ? 0.25 : 0);
    const fadeOut = Math.max(0.1, duration - 0.35).toFixed(3);
    const vf = `[0:v]split=2[bg0][fg0];[bg0]scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},boxblur=24:12[bg];[fg0]scale=${width}:${height}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,zoompan=z='min(zoom+0.00065,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${width}x${height}:fps=30,trim=duration=${duration.toFixed(3)},setpts=PTS-STARTPTS,fade=t=in:st=0:d=0.30,fade=t=out:st=${fadeOut}:d=0.30,format=yuv420p[v]`;
    await run('ffmpeg', ['-y', '-loop', '1', '-framerate', '30', '-i', pageFiles[i], '-filter_complex', vf, '-map', '[v]', '-t', duration.toFixed(3), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '21', '-r', '30', '-pix_fmt', 'yuv420p', output]);
    clips.push(output);
    await callback({ status: 'rendering', progress: Math.min(90, 20 + Math.round((i + 1) / pageFiles.length * 65)) });
  }
  const clipList = clips.map(file => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n';
  await writeFile(path.join(temp, 'clip-list.txt'), clipList);
  const silentVideo = path.join(temp, 'silent.mp4');
  await run('ffmpeg', ['-y', '-f', 'concat', '-safe', '0', '-i', path.join(temp, 'clip-list.txt'), '-c', 'copy', silentVideo]);
  const finalVideo = path.join(temp, 'comicflow-final.mp4');
  await run('ffmpeg', ['-y', '-i', silentVideo, '-i', narration, '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', finalVideo]);
  const stat = await (await import('node:fs/promises')).stat(finalVideo);
  if (stat.size < 100000) throw new Error('The rendered MP4 is unexpectedly small.');
  const verification = await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height', '-of', 'json', finalVideo]);
  const probeData = JSON.parse(verification.stdout);
  const duration = Number(probeData.format?.duration);
  const streams = probeData.streams || [];
  const videoStream = streams.find(stream => stream.codec_type === 'video');
  const audioStream = streams.find(stream => stream.codec_type === 'audio');
  if (!videoStream || !audioStream || !Number.isFinite(duration) || duration < 1 || Math.abs(duration - totalDuration) > 1.5) {
    throw new Error('The final MP4 failed validation: video/audio streams or expected duration are missing.');
  }
  if (videoStream.width !== width || videoStream.height !== height) throw new Error('The final MP4 dimensions do not match the selected format.');
  await callback({ status: 'rendering', progress: 95 });
  const video = await readFile(finalVideo);
  const blob = await put(`comicflow/videos/${jobId}.mp4`, video, { access: 'public', addRandomSuffix: true, contentType: 'video/mp4', token: blobToken });
  await callback({ status: 'complete', videoUrl: blob.url });
  console.log(`Render complete: ${blob.url}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  await callback({ status: 'failed', error: message }).catch(e => console.error('Status callback failed:', e));
  console.error(message);
  process.exitCode = 1;
} finally {
  if (temp) await rm(temp, { recursive: true, force: true }).catch(() => {});
}
