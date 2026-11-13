# ComicFlow worker setup

The extraction worker runs on a temporary GitHub Actions Ubuntu runner. It installs Chromium and Ollama, downloads the Qwen2.5-VL 3B vision-language model, extracts authorized comic page images with Playwright, analyzes each image locally, and generates the recap script locally. The model is downloaded again for each job because GitHub-hosted runners are ephemeral.

## Vercel environment variables

- `APP_PASSWORD`: dashboard password.
- `BLOB_PRIVATE_READ_WRITE_TOKEN`: token for the Private Blob store.
- `BLOB_PUBLIC_READ_WRITE_TOKEN`: token for the Public Blob store.
- `WORKER_SECRET`: long random secret shared with the Actions worker.
- `GITHUB_OWNER`: repository owner.
- `GITHUB_REPO`: repository name.
- `GITHUB_TOKEN`: fine-grained token for this repository with Actions: write and Metadata: read.
- `GITHUB_WORKFLOW_REF`: branch containing the Ollama workflow; set to `fix/comicflow-pipeline-2026-11-13` while using this branch.

No Groq, Together AI, Cerebras, or other external AI API keys are required.

## GitHub Actions repository secrets

Add these repository secrets:

- `COMICFLOW_API_URL`: deployed app origin, for example `https://your-project.vercel.app` (no trailing slash).
- `COMICFLOW_WORKER_SECRET`: exactly the same value as Vercel `WORKER_SECRET`.
- `BLOB_PUBLIC_READ_WRITE_TOKEN`: token for the Public Vercel Blob store.

## Validate configuration

After deploying, sign in to the dashboard and open `/api/diagnostics`. It returns boolean readiness checks and never returns secret values. A green `readyForExtraction` confirms the Vercel and GitHub dispatch configuration; the Ollama model itself is verified in the GitHub Actions worker logs.

## Local Ollama behavior

The workflow starts the local Ollama service, pulls `qwen2.5vl:3b`, and sends each extracted page image to the model through Ollama's local API. The same model generates the final narration JSON from the visual notes. No remote AI inference provider is called. The runner is temporary, so the model is downloaded again on later jobs.

## GlobalComix access

The Playwright worker follows the supplied URL, checks that it resolves to GlobalComix, waits for lazy-loaded images while scrolling, and captures full-size image elements. It does not sign in, purchase chapters, remove overlays, defeat anti-bot measures, or bypass access restrictions. Use only chapters that are free to view or that you have permission to process.

## Video rendering

After the script is ready, the existing Edge TTS endpoint creates audio. The render workflow uses FFmpeg, validates audio/video streams and dimensions, then uploads the MP4 to the Public Blob store.
