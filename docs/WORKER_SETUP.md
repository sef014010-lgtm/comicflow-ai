# ComicFlow worker setup

The extraction worker runs outside Vercel Functions because Chromium and Ollama are too large for a serverless request. Each GitHub Actions job installs Chromium and downloads the small Qwen2.5 1.5B model into an ephemeral runner; the model is not persistent between jobs.

## Vercel environment variables

Set these for the deployment environment used by the app:

- `APP_PASSWORD`: dashboard password.
- `ENCRYPTION_SECRET`: exactly 64 hexadecimal characters (32 bytes).
- `BLOB_PRIVATE_READ_WRITE_TOKEN`: token for the Private Blob store.
- `BLOB_PUBLIC_READ_WRITE_TOKEN`: token for the Public Blob store.
- `WORKER_SECRET`: long random secret shared with the Actions worker.
- `GITHUB_OWNER`: repository owner.
- `GITHUB_REPO`: repository name.
- `GITHUB_TOKEN`: fine-grained token for this repository with Actions: write and Metadata: read.
- `GITHUB_WORKFLOW_REF`: set to `main` after the PR is merged. For preview testing, set it to the branch containing the workflow.

## GitHub Actions repository secrets

Add these three repository secrets:

- `COMICFLOW_API_URL`: deployed app origin, for example `https://your-project.vercel.app` (no trailing slash).
- `COMICFLOW_WORKER_SECRET`: exactly the same value as Vercel `WORKER_SECRET`.
- `BLOB_PUBLIC_READ_WRITE_TOKEN`: token for the Public Vercel Blob store.

The Groq key is saved encrypted by the app in the Private Blob store and is passed only from the authenticated worker API to the GitHub runner for the vision step. Never commit keys or paste them into issues.

## Validate configuration

After deploying, sign in to the dashboard and open:

`/api/diagnostics`

The endpoint returns boolean readiness checks only; it never returns secret values. A green `readyForExtraction` means the required Vercel-side variables and saved Groq key are present. GitHub Actions secrets are separately validated at the beginning of the extraction workflow.

## GlobalComix access

The Playwright worker follows the supplied URL, checks that it resolves to GlobalComix, waits for lazy-loaded images while scrolling, and captures full-size image elements. It does not sign in, purchase chapters, remove overlays, defeat anti-bot measures, or bypass access restrictions. Use only chapters that are free to view or that you have permission to process.

## Local Qwen behavior

The extraction workflow starts Ollama on the GitHub-hosted runner and pulls `qwen2.5:1.5b`. Qwen runs locally on that runner for text generation. The runner is temporary, so the model is downloaded again for a later job. Groq Vision remains a separate cloud vision service and requires the saved Groq API key.

## Video rendering

After the script is ready, the existing Edge TTS endpoint creates audio. The render workflow uses FFmpeg, validates audio/video streams and dimensions, then uploads the MP4 to the Public Blob store.
