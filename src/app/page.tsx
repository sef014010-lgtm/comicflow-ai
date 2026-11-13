"use client";
import { useEffect, useMemo, useState, type FormEvent } from "react";

type Job = {
  id: string; status: string; format: string; provider: string; narration: string; createdAt?: string; updatedAt?: string;
  youtubeTitle: string; description: string; keywords: string[]; hashtags: string[];
  pages: Array<{ url: string; page: number }>; visualNotes: string;
  audioParts?: Array<{ url: string; index: number; attempts: number }>;
  videoUrl?: string; error?: string; progress?: number; voice?: string;
};
const statusLabels: Record<string, string> = {
  extracting: "Extracting pages + local Qwen script",
  script_ready: "Script ready", audio_ready: "Voice ready", queued: "Waiting for render worker",
  rendering: "Rendering video on GitHub Actions", complete: "Video ready", failed: "Needs attention"
};
export default function Home() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [urls, setUrls] = useState(""); const [format, setFormat] = useState("shorts");
  const [tone, setTone] = useState("Cinematic, engaging and suspenseful");
  const [voice, setVoice] = useState("en-US-AndrewNeural");
  const [job, setJob] = useState<Job | null>(null); const [recentJobs, setRecentJobs] = useState<Job[]>([]); const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(""); const [error, setError] = useState("");
  const urlList = useMemo(() => urls.split("\n").map(x => x.trim()).filter(Boolean), [urls]);
  async function api(path: string, options: RequestInit = {}) {
    const response = await fetch(path, { ...options, headers: { "Content-Type": "application/json", "x-app-password": password, ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);
    return data;
  }
  async function login(e: FormEvent) {
    e.preventDefault(); setError(""); setBusy(true);
    try {
      await api("/api/settings");
      setAuthenticated(true); setStatus("Dashboard unlocked.");
      const history = await api("/api/jobs"); setRecentJobs(history.jobs || []);
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  }
  async function createScript() {
    setBusy(true); setError(""); setStatus("Starting Playwright extraction, local Qwen2.5-VL vision analysis, and local script generation...");
    try {
      const data = await api("/api/analyze", { method: "POST", body: JSON.stringify({ urls: urlList, format, tone }) });
      setJob(data); setRecentJobs(old => [data, ...old.filter(x => x.id !== data.id)]); setStatus(`Script created from ${data.pages.length} complete page images using ${data.provider}.`);
    } catch (e: any) { setError(e.message); setStatus(""); }
    finally { setBusy(false); }
  }
  async function makeVoice() {
    if (!job) return;
    setBusy(true); setError(""); setStatus("Generating neural narration. Each audio segment can retry up to four times...");
    try {
      const data = await api("/api/tts", { method: "POST", body: JSON.stringify({ jobId: job.id, text: job.narration, voice, rate: "+0%" }) });
      const updated = await api(`/api/jobs/${job.id}`); setJob(updated); setRecentJobs(old => [updated, ...old.filter(x => x.id !== updated.id)]);
      setStatus(`Voice generated: ${data.totalParts} audio segment(s).`);
    } catch (e: any) { setError(e.message); setStatus(""); }
    finally { setBusy(false); }
  }
  async function queueRender() {
    if (!job) return;
    setBusy(true); setError(""); setStatus("Sending the render job to GitHub Actions...");
    try { await api("/api/render", { method: "POST", body: JSON.stringify({ jobId: job.id }) }); setJob({ ...job, status: "queued", progress: 2 }); setStatus("Render job queued. You can keep this page open or return later."); }
    catch (e: any) { setError(e.message); setStatus(""); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (!authenticated || !job?.id || !["extracting", "queued", "rendering"].includes(job.status)) return;
    let active = true;
    const poll = async () => { try { const latest = await api(`/api/jobs/${job.id}`); if (active) { setJob(latest); setRecentJobs(old => [latest, ...old.filter(x => x.id !== latest.id)]); } } catch {} };
    const timer = window.setInterval(poll, 5000); poll();
    return () => { active = false; window.clearInterval(timer); };
  }, [authenticated, job?.id, job?.status]);
  function downloadPackage() {
    if (!job) return;
    const text = `TITLE\n${job.youtubeTitle}\n\nNARRATION\n${job.narration}\n\nDESCRIPTION\n${job.description}\n\nKEYWORDS\n${(job.keywords || []).join(", ")}\n\nHASHTAGS\n${(job.hashtags || []).join(" ")}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "comicflow-youtube-package.txt"; a.click(); URL.revokeObjectURL(url);
  }
  if (!authenticated) return <main className="login-shell"><div className="login-card"><div className="brand-mark">CF</div><p className="eyebrow">CREATOR WORKSPACE</p><h1>ComicFlow <span>AI</span></h1><p className="muted">Your cinematic comic recap production studio.</p><form onSubmit={login}><label>Dashboard password</label><input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Enter your app password" required/><button className="primary full" disabled={busy}>{busy ? "Checking..." : "Unlock workspace"}</button></form>{error && <p className="error">{error}</p>}<p className="tiny">Private workspace · AI processing runs on the GitHub worker with local Ollama</p></div></main>;
  return <main className="app-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark small">CF</div><div><strong>ComicFlow <span>AI</span></strong><small>RECAP PRODUCTION STUDIO</small></div></div><div className="top-actions"><span className="secure"><i/> Private workspace</span><span className="secure"><i/> Local AI · Ollama Qwen2.5-VL</span></div></header>
    <section className="hero"><div><p className="eyebrow">FROM COMIC PAGES TO CINEMATIC VIDEO</p><h1>Turn a chapter into<br/><em>a story worth watching.</em></h1><p className="hero-copy">Extract authorized chapter pages with Playwright, write a recap with local Qwen, generate narration, and render an MP4 in the cloud.</p></div><div className="hero-art"><div className="art-orbit orbit-one"/><div className="art-orbit orbit-two"/><div className="art-card card-back">STORY<br/>FLOW</div><div className="art-card card-front"><span>01</span><b>PAGE</b><span className="art-line"/><b>VOICE</b><span className="art-line"/><b>VIDEO</b></div><div className="art-glow"/></div></section>
    {recentJobs.length > 0 && <section className="panel history-panel"><div className="section-head"><div><p className="eyebrow">RECENT WORK</p><h2>Your recent projects</h2></div><span className="step-number">{recentJobs.length}</span></div><div className="history-list">{recentJobs.slice(0, 5).map(item => <button key={item.id} className={`history-item ${job?.id === item.id ? "selected" : ""}`} onClick={async () => { try { const full = await api(`/api/jobs/${item.id}`); setJob(full); setError(""); } catch (e: any) { setError(e.message); } }}><span className="history-status"/><span className="history-title">{item.youtubeTitle || "Untitled recap"}<small>{new Date(item.updatedAt || item.createdAt || Date.now()).toLocaleString()} · {item.pages?.length || 0} pages</small></span><span className="history-state">{statusLabels[item.status] || item.status}</span></button>)}</div></section>}
    <div className="workspace-grid"><section className="panel input-panel"><div className="section-head"><div><p className="eyebrow">01 / SOURCE</p><h2>Start a new recap</h2><p className="muted">Add up to three chapter URLs. Every discovered complete page is analyzed and included in the final render — no fixed page-count cap.</p></div><span className="step-number">01</span></div><label>Chapter URL(s)</label><textarea value={urls} onChange={e => setUrls(e.target.value)} placeholder="https://example.com/comic/chapter-01\nhttps://example.com/comic/chapter-02" rows={4}/><div className="field-note">One URL per line · Maximum 3 chapter URLs · all discovered pages are processed</div><div className="two-fields"><div><label>Video format</label><select value={format} onChange={e => setFormat(e.target.value)}><option value="shorts">YouTube Shorts · 9:16</option><option value="landscape">Landscape · 16:9</option></select></div><div><label>Narration tone</label><select value={tone} onChange={e => setTone(e.target.value)}><option>Cinematic, engaging and suspenseful</option><option>Energetic and dramatic</option><option>Clear documentary storytelling</option><option>Mysterious and atmospheric</option></select></div></div><button className="primary full" onClick={createScript} disabled={busy || !urlList.length || urlList.length > 3}>{busy ? "Working..." : "Analyze pages & write script"}<span>→</span></button><p className="hint">Vision and script generation run locally with Ollama · Qwen2.5-VL 3B. No AI API key required.</p></section>
    <section className="panel pipeline-panel"><div className="section-head"><div><p className="eyebrow">02 / WORKFLOW</p><h2>Production pipeline</h2><p className="muted">Each stage saves its output before moving forward.</p></div><span className="step-number">02</span></div><div className="pipeline"><div className="pipeline-step active"><span className="pipeline-icon">01</span><div><b>Page extraction</b><small>Playwright Chromium + lazy-loaded pages</small></div><span className="check">✓</span></div><div className="pipeline-step"><span className="pipeline-icon">02</span><div><b>Story intelligence</b><small>Local Ollama · Qwen2.5-VL Vision + Script</small></div></div><div className="pipeline-step"><span className="pipeline-icon">03</span><div><b>Neural voice</b><small>US English Edge TTS · retry ×4</small></div></div><div className="pipeline-step"><span className="pipeline-icon">04</span><div><b>Cloud rendering</b><small>FFmpeg on GitHub-hosted runner</small></div></div><div className="pipeline-step"><span className="pipeline-icon">05</span><div><b>MP4 delivery</b><small>Upload final video to Vercel Blob</small></div></div></div><div className="pipeline-foot"><span className="pulse-dot"/> Render runs outside Vercel Functions</div></section></div>
    {(status || error) && <div className="notice-row">{status && <p className="status">{status}</p>}{error && <p className="error">{error}</p>}</div>}
    {job && <section className="panel result-panel"><div className="section-head"><div><p className="eyebrow">03 / YOUR PROJECT</p><h2>Recap workspace</h2><p className="muted">Job ID <code>{job.id}</code> · {job.pages.length} complete pages · {job.format === "shorts" ? "9:16 Shorts" : "16:9 Landscape"}</p></div><span className={`status-pill ${job.status}`}>{statusLabels[job.status] || job.status}</span></div>
      <div className="progress-wrap"><div className="progress-label"><span>Cloud render progress</span><b>{job.progress || 0}%</b></div><div className="progress-track"><div className="progress-value" style={{ width: `${job.progress || 0}%` }}/></div></div>
      <div className="page-strip">{job.pages.map((page, i) => <div className="page-thumb" key={page.page}><img src={page.url} alt={`Complete comic page ${page.page}`}/><span>PAGE {String(page.page).padStart(2, "0")}</span></div>)}</div>
      <div className="script-block"><div className="section-head compact"><div><p className="eyebrow">NARRATION SCRIPT</p><h3>{job.youtubeTitle}</h3></div><span className="provider-tag">{job.provider}</span></div><textarea className="script-editor" value={job.narration} onChange={e => setJob({ ...job, narration: e.target.value })} rows={8}/><div className="voice-controls"><div><label>US English neural voice</label><select value={voice} onChange={e => setVoice(e.target.value)}><option value="en-US-AndrewNeural">Andrew · Male · Natural</option><option value="en-US-AriaNeural">Aria · Female · Conversational</option><option value="en-US-GuyNeural">Guy · Male · Natural</option><option value="en-US-JennyNeural">Jenny · Female · Friendly</option><option value="en-US-ChristopherNeural">Christopher · Male · News</option><option value="en-US-EricNeural">Eric · Male · Conversational</option></select></div><button className="secondary" onClick={makeVoice} disabled={busy || !job.narration.trim() || ["queued", "rendering"].includes(job.status)}>{busy ? "Please wait..." : job.audioParts?.length ? "Regenerate voice" : "Generate voice"}</button></div>{job.audioParts?.length ? <div className="audio-preview"><div className="audio-ready">✓ {job.audioParts.length} audio segment(s) ready · up to four attempts per segment</div>{job.audioParts.map(part => <div className="audio-row" key={part.index}><span>VOICE {String(part.index).padStart(2, "0")}</span><audio controls preload="none" src={part.url}/><a href={part.url} target="_blank" rel="noreferrer">MP3 ↗</a></div>)}</div> : null}</div>
      <div className="metadata-grid"><div><label>DESCRIPTION</label><p>{job.description}</p></div><div><label>KEYWORDS</label><p>{(job.keywords || []).join(" · ")}</p></div><div><label>HASHTAGS</label><p>{(job.hashtags || []).join(" ")}</p></div></div>
      <div className="result-actions"><button className="ghost" onClick={downloadPackage}>Download YouTube text package</button><button className="primary" onClick={queueRender} disabled={busy || !job.audioParts?.length || job.status === "complete" || ((job.status === "queued" || job.status === "rendering") && Date.now() - new Date(job.updatedAt || job.createdAt || Date.now()).getTime() < 45 * 60 * 1000)}>{job.status === "queued" || job.status === "rendering" ? (Date.now() - new Date(job.updatedAt || job.createdAt || Date.now()).getTime() < 45 * 60 * 1000 ? "Rendering in cloud..." : "Retry stalled render →") : job.status === "complete" ? "Render complete" : "Render final MP4 →"}</button></div>
      {job.status === "failed" && <p className="error">{job.error || "The render failed. Please try again."}</p>}
      {job.videoUrl && <div className="video-result"><div><p className="eyebrow">FINAL EXPORT</p><h3>Your video is ready</h3><p className="muted">The MP4 is stored in Vercel Blob.</p><video controls playsInline src={job.videoUrl}/></div><a className="primary link-button" href={job.videoUrl} target="_blank" rel="noreferrer">Open / download MP4 ↗</a></div>}
    </section>}
    <footer><span>COMICFLOW AI · PRODUCTION BUILD</span><span>Use content you own or are authorized to process. Source-site access controls are not bypassed.</span></footer>
  </main>;
}
