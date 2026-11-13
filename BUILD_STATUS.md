# Build and test status

Date: 2026-11-11

## Passed in this environment

- All TypeScript and TSX source files passed a syntax transpilation check using the installed TypeScript compiler API.
- `worker/render.mjs` passed `node --check` after adding final MP4 stream, dimension and duration validation.
- API validation was tightened for UUIDs, supported TTS voices/rates, chapter/audio manifest bounds, and final Blob URL host checks.
- AI-generated metadata is length-limited and sanitized before saving.
- The GitHub Actions workflow YAML was parsed successfully (the YAML 1.1 parser displays the `on` key as boolean `true`; GitHub Actions uses its workflow YAML interpretation).
- A representative FFmpeg test rendered a full-page still image with the project's blur/zoom/fade filter, muxed a narration audio track, and produced a valid MP4 verified by `ffprobe` (1080x1920 with both audio and video streams and a 2-second duration).

## Not passed / not run

- `npm install` could not finish because the package registry was unreachable from this environment.
- Consequently `npm run typecheck` and `npm run build` were not completed with the real Next.js/React/Vercel dependency tree.
- No live Vercel deployment, Blob upload, Ollama local vision inference, Edge TTS request, GitHub workflow dispatch, or end-to-end chapter render was possible without the user's accounts and credentials.

Do not describe this project as fully production-tested until the deployment checklist in `README.md` has been completed with a short, authorized sample chapter.
