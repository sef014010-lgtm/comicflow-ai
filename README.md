# ComicFlow AI — Production-oriented Vercel + GitHub Actions build

ComicFlow turns **complete comic/manhwa page images** into a narrated recap video. It deliberately does not split pages into panels or banners. The page is preserved as one image, then animated with a slow cinematic zoom, blurred background fill, and short fades.

## Architecture selected

- **Vercel / Next.js:** dashboard, password gate, encrypted provider-key settings, chapter extraction, vision analysis, narration script, Edge TTS, job state and API.
- **GitHub Actions:** FFmpeg video rendering on an ephemeral GitHub-hosted Ubuntu runner. This avoids rendering in the browser and avoids Vercel Function duration limits for the video encode stage.
- **Vercel Blob:** public media store for source page images, audio and final MP4; private media store for encrypted API keys and private job manifests.
- **AI provider order:** Groq is required for image Vision and primary text generation; Together AI and Cerebras are optional text-generation fallbacks. Image Vision currently uses Groq only.

This is a deployable application codebase, not a hosted service. The owner must create the Vercel project, Blob stores, GitHub repository and secrets. No provider key or deployment credential is included in the ZIP.

## Important boundaries

- The analyzer currently supports ordinary public HTML pages with standard `img` tags and common lazy-load attributes. It does not execute arbitrary website JavaScript and does not bypass logins, paywalls, CAPTCHA, anti-bot protections or other access controls.
- Use only pages and images you own or are authorized to process. Do not submit adult/explicit material.
- Up to 3 chapter URLs and 12 discovered page images are accepted per job in this build. This is intentionally bounded to fit Vercel's request window during extraction/analysis. Larger chapters should be processed as multiple jobs. The current render worker accepts up to 12 pages and 3 audio segments.
- Each image is limited to 12 MB. Source image extraction and AI analysis run in a Vercel Function capped at 300 seconds in this project; Vercel Hobby's current Fluid Compute limit is up to 300 seconds. Unusually slow sites or providers may still time out. The FFmpeg render itself runs in GitHub Actions.
- GitHub-hosted Actions jobs have a maximum execution time of 6 hours. Standard GitHub-hosted runners are free for public repositories; private repositories receive plan-dependent included compute (GitHub Free currently lists $12/month of included compute, with overages governed by billing settings). `ubuntu-latest` standard runners currently provide 4 CPUs, 16 GB RAM and 14 GB SSD. Public-runner minutes may be free, but individual jobs, concurrency, storage, abuse policies and other GitHub limits still apply. See GitHub Actions billing, runner specifications and limits.
- A standard GitHub-hosted runner is a temporary machine, not an always-on server. It is appropriate for queued jobs and render-on-demand, not persistent APIs or real-time workloads.
- Edge TTS is an unofficial online integration and depends on the upstream service. Each segment retries up to three times.
- Output is 1080x1920 for Shorts or 1920x1080 for landscape, H.264 video + AAC audio. The current renderer assigns an equal share of the narration duration to each complete page; it does not yet offer per-page manual timing or word-level lip-sync. It applies a slow zoom and fades; transitions are not true overlapping crossfades. Long videos may take several minutes and consume Actions minutes.
- Page images, generated audio and final MP4 are stored in the Public Blob store. Anyone who has one of those URLs can access that media. Do not use sensitive/private images.
- The dashboard password is a single shared gate, not multi-user authentication. Do not expose this site publicly without adding real accounts, rate limits, per-user quotas, CSRF protections and audit logging.

## 1. Create a GitHub repository

1. Create a **private** GitHub repository for this project (recommended to keep source private).
2. Upload the contents of this ZIP to the repository root. The `.github/workflows/render-video.yml` file must remain at that exact path.
3. Ensure the default branch is `main` (or change `GITHUB_WORKFLOW_REF` and the dispatch ref accordingly).
4. Keep GitHub Actions enabled for the repository.

The workflow is started by the Vercel API using the GitHub `workflow_dispatch` endpoint. Create a fine-grained Personal Access Token scoped to this repository with **Actions: Read and write** permission. Store it only in Vercel as `GITHUB_TOKEN`; do not place it in the browser or commit it.

## 2. Create the Vercel project

1. Import the GitHub repository into Vercel as a Next.js project.
2. Set the Root Directory to the project root (where `package.json` lives).
3. Use Node.js 22.
4. Deploy once after configuring environment variables.

## 3. Create TWO Vercel Blob stores

The Blob access type is selected when creating a store, so this project uses two separate stores:

- **Public Blob store:** stores page images, generated audio and final MP4 files. Set its token as `BLOB_PUBLIC_READ_WRITE_TOKEN`.
- **Private Blob store:** stores encrypted provider keys and job manifests. Set its token as `BLOB_PRIVATE_READ_WRITE_TOKEN`.

Connect each store to the Vercel project or copy its read/write token into the matching environment variable. Do not swap the tokens.

## 4. Configure Vercel environment variables

Set all of these in Vercel → Project → Settings → Environment Variables:

| Variable | Required | Value |
|---|---|---|
| `BLOB_PUBLIC_READ_WRITE_TOKEN` | Yes | Read/write token from the Public Blob store |
| `BLOB_PRIVATE_READ_WRITE_TOKEN` | Yes | Read/write token from the Private Blob store |
| `APP_PASSWORD` | Yes | A long, unique dashboard password |
| `ENCRYPTION_SECRET` | Yes | 64 hexadecimal characters (32 random bytes) |
| `WORKER_SECRET` | Yes | A separate long random secret shared only with GitHub Actions |
| `GITHUB_TOKEN` | Yes | Fine-grained PAT with Actions read/write on this repo |
| `GITHUB_OWNER` | Yes | GitHub account or organization name |
| `GITHUB_REPO` | Yes | Repository name |
| `GITHUB_WORKFLOW_REF` | Recommended | Branch containing the workflow, normally `main` |
| `GROQ_TEXT_MODEL` | Optional | Text model currently available in your Groq account |
| `GROQ_VISION_MODEL` | Optional | Vision model currently available in your Groq account |
| `TOGETHER_MODEL` | Optional | Together model currently available in your account |
| `CEREBRAS_MODEL` | Optional | Cerebras model currently available in your account |

Generate secrets locally:

```bash
openssl rand -hex 32   # ENCRYPTION_SECRET
openssl rand -hex 32   # WORKER_SECRET
```

Keep `ENCRYPTION_SECRET` stable after saving provider keys. If it changes, previously encrypted keys cannot be decrypted.

## 5. Configure GitHub Actions secrets

In GitHub → Repository → Settings → Secrets and variables → Actions, add:

| Secret | Value |
|---|---|
| `COMICFLOW_API_URL` | Your deployed Vercel URL, e.g. `https://your-project.vercel.app` (no trailing slash) |
| `COMICFLOW_WORKER_SECRET` | Exactly the same value as Vercel `WORKER_SECRET` |
| `BLOB_PUBLIC_READ_WRITE_TOKEN` | Exactly the same public Blob token as Vercel `BLOB_PUBLIC_READ_WRITE_TOKEN` |

Do not add the private Blob token to GitHub Actions. The worker only uploads the final public MP4.

## 6. Deploy and configure AI keys

1. Redeploy Vercel after setting environment variables.
2. Open the Vercel URL and enter `APP_PASSWORD`.
3. Open **API settings**.
4. Enter the Groq key (required), and optionally Together AI and Cerebras keys.
5. Save the keys. They are encrypted with AES-256-GCM before being written to the Private Blob store.

## 7. Create a video

1. Paste one to three authorized chapter URLs (one URL per line).
2. Select Shorts (9:16) or Landscape (16:9), and choose a narration tone.
3. Click **Analyze pages & write script**. The app extracts complete page images, stores them, analyzes them with Groq Vision, and writes narration plus YouTube metadata.
4. Review and edit the narration if needed.
5. Choose a US English voice and click **Generate voice**. Edge TTS creates audio segments with up to three attempts per segment.
6. Click **Render final MP4**. Vercel dispatches the GitHub Actions workflow. The worker downloads pages and audio, renders each page with FFmpeg, joins the segments, muxes the narration, uploads the MP4 to Public Blob, and reports the result to Vercel.
7. Keep the dashboard open to watch progress, or return later and unlock it again. While a job is queued/rendering, the dashboard polls its saved status.

## 8. Local development

```bash
npm install
cp .env.example .env.local
# Fill in the required environment values
npm run dev
```

For local rendering tests, run the worker with `ffmpeg` and `ffprobe` installed and provide the worker environment variables. Normal production rendering is started by GitHub Actions.

## 9. What is and is not verified

This package includes the frontend, API routes, workflow, worker and deployment instructions. The worker includes a final FFprobe check for audio/video streams, dimensions and duration. In this build environment, the changed TypeScript/TSX files were syntax-transpiled and `worker/render.mjs` passed Node syntax validation. A full dependency installation timed out because the package registry was not reachable, so a complete Next.js production build and live Vercel/GitHub integration test could not be completed here. The project still needs to be connected to the owner's real Vercel/GitHub accounts and provider keys. A successful syntax check does not prove that a particular source website, provider model, Edge TTS voice or GitHub account will work. Validate the full pipeline with a short authorized sample chapter after deployment before relying on it for larger projects.

## 10. Troubleshooting

- **401 / dashboard won't unlock:** confirm `APP_PASSWORD` is identical to the value entered.
- **Private Blob errors:** verify `BLOB_PRIVATE_READ_WRITE_TOKEN` belongs to a Private store.
- **Public asset upload errors:** verify `BLOB_PUBLIC_READ_WRITE_TOKEN` belongs to a Public store.
- **AI provider errors:** confirm API keys, billing/quota, and current model IDs. Change model IDs in Vercel environment variables if the provider retires one.
- **No images found:** the source may require JavaScript, login, or a site-specific integration. This generic extractor will not bypass those controls.
- **GitHub dispatch fails:** check `GITHUB_OWNER`, `GITHUB_REPO`, branch name, workflow file path, Actions enabled, and token Actions write permission.
- **Worker cannot reach Vercel:** check `COMICFLOW_API_URL`, `COMICFLOW_WORKER_SECRET`, and that Vercel deployment is active.
- **Render fails:** open GitHub → Actions → ComicFlow video render → failed run and inspect logs. The worker posts a concise error back to the dashboard when possible.
- **Job exceeds 6 hours:** GitHub cancels the job. Reduce chapter length or split the chapter into multiple jobs.
- **Final MP4 validation fails:** inspect the Actions log for the FFprobe validation message. The worker verifies that the export contains both audio and video streams, the selected output dimensions, and a duration close to the narration duration.

## Official references

- GitHub Actions workflow syntax and job timeout: https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax
- GitHub Actions usage and billing: https://docs.github.com/en/actions/concepts/billing-and-usage
- GitHub-hosted runner specifications: https://docs.github.com/en/actions/reference/runners/github-hosted-runners
- GitHub Actions limits: https://docs.github.com/en/actions/reference/limits
- Vercel Blob: https://vercel.com/docs/vercel-blob
- Vercel Blob private storage: https://vercel.com/docs/vercel-blob/private-storage
- Vercel Function limitations: https://vercel.com/docs/functions/limitations
