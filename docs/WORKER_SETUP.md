# ComicFlow worker setup

The extraction worker runs on a temporary GitHub Actions Ubuntu runner. It installs Chromium and Ollama, then downloads `qwen2.5vl:3b`. The same local multimodal model analyzes comic page images and writes the recap script. No Groq, Together AI, Cerebras, or other AI-provider key is needed.

## Vercel environment variables

Set these for the deployment environment used by the app:

- `APP_PASSWORD`: dashboard password.
- `ENCRYPTION_SECRET`: exactly 64 hexadecimal characters (32 bytes).
- `BLOB_PRIVATE_READ_WRITE_TOKEN`: token for the Private Blob store used for private job data.
- `BLOB_PUBLIC_READ_WRITE_TOKEN`: token for the Public Blob store.
- `WORKER_SECRET`: long random secret shared with the Actions worker.
- `GITHUB_OWNER`: repository owner.
- `GITHUB_REPO`: repository name.
- `GITHUB_TOKEN`: fine-grained token for this repository with Actions: write and Metadata: read.
- `GITHUB_WORKFLOW_REF`: set to `main` after the workflow is on the default branch.

## GitHub Actions repository secrets

Add these three repository secrets:

- `COMICFLOW_API_URL`: deployed app origin, for example `https://your-project.vercel.app` (no trailing slash).
- `COMICFLOW_WORKER_SECRET`: exactly the same value as Vercel `WORKER_SECRET`.
- `BLOB_PUBLIC_READ_WRITE_TOKEN`: token for the Public Vercel Blob store.

No AI provider key or model variable is required.

## Validate configuration

After deploying, sign in to the dashboard and open `/api/diagnostics`. It returns readiness checks without exposing secret values. The extraction workflow validates the GitHub worker secrets before it starts.

## Local AI models

The extraction workflow starts Ollama on the GitHub-hosted runner and pulls `qwen2.5vl:3b`. It sends each extracted page image directly to the model using Ollama's local `/api/generate` endpoint and the `images` field. The model returns page-by-page visual notes, then the same local model writes the narration and YouTube metadata as JSON. There are no paid AI API calls or AI-provider keys in this pipeline.

The GitHub runner is temporary, so the model is downloaded again for every new workflow run. The 3B vision-language model needs more download time and memory than the old 1.5B text-only model. Vision inference is CPU-capable but may take several minutes depending on page count and runner load.

## GlobalComix access

The Playwright worker follows the supplied URL, checks that it resolves to GlobalComix, waits for lazy-loaded images while scrolling, and captures full-size image elements. It does not sign in, purchase chapters, remove overlays, defeat anti-bot measures, or bypass access restrictions. Use only chapters that are free to view or that you have permission to process.

## Video rendering

After the script is ready, the existing Edge TTS endpoint creates audio. The render workflow uses FFmpeg, validates audio/video streams and dimensions, then uploads the MP4 to the Public Blob store.
