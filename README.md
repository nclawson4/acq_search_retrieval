# acq_search_retrieval

Multi-modal search and retrieval over a long-form video library. The same retrieval core is surfaced two ways:

- **Web portal:** [acq-search-retrieval.vercel.app](https://acq-search-retrieval.vercel.app)
- **Remote MCP server (Streamable HTTP):** `https://acq-search-retrieval.vercel.app/api/mcp`

The intent is editor-grade sourcing: given a natural-language query, return ranked, timestamped moments that combine what was said (transcript) and what was on screen (visual).

## What it indexes

For every video in the corpus:

- **Transcript segments** — Whisper word-level timestamps, windowed into ~30 s overlapping segments snapped to sentence boundaries, embedded with OpenAI `text-embedding-3-small`.
- **Keyframes at scene changes** — extracted with PySceneDetect, resized + JPEG-compressed, embedded with open CLIP `ViT-L-14` (LAION-2B), stored on Vercel Blob.

A text query embeds once and searches the segment index. Each result card shows the nearest keyframe to the matching moment, giving you the idea + the shot in one view. True cross-modal text-to-frame retrieval (e.g. *"him at the whiteboard"*) is a v2 add using CLIP's text encoder at query time.

## Why multi-modal

Transcript search finds the idea. Frame search finds the shot. Thumbnail and B-roll work is a visual problem; transcript-only retrieval can't reach it. Audio energy / tone is the planned third modality.

## Stack

| Layer | Tool |
| --- | --- |
| Ingest | Python 3.12 · yt-dlp · ffmpeg · scenedetect · OpenAI Whisper API · open-clip-torch |
| Vector store | Qdrant Cloud (`segments` + `frames` collections) |
| Metadata store | Neon Postgres |
| Object storage | Vercel Blob (frame thumbnails) |
| Portal + MCP | Next.js 16 App Router on Vercel (Fluid Compute) |
| Rate limiting | Upstash Redis (`@upstash/ratelimit`) |
| Eval | Golden queries + synthetic paraphrase eval, dashboard at `/eval` |

Marketplace integrations (Neon, Upstash) and Vercel Blob are auto-provisioned; secrets stay out of the repo. GitHub secret scanning + push protection + gitleaks pre-commit + CI keep the public repo clean.

## Layout

```
web/      Next.js portal + MCP HTTP endpoint
ingest/   Python ingestion pipeline (CLI)
eval/     Golden queries
docs/     Architecture notes
urls.txt  V1 video corpus
```

## Using the MCP server

Any MCP-compatible client can connect over Streamable HTTP. Quick `curl` smoke test:

```bash
# List tools
curl -X POST https://acq-search-retrieval.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":1}'

# Search
curl -X POST https://acq-search-retrieval.vercel.app/api/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/call",
       "params":{"name":"search_moments","arguments":{"query":"the value equation","k":5}},
       "id":2}'
```

Two tools are exposed:

- `search_moments(query, k?, video_id?)` — ranked timestamped moments
- `get_video(video_id)` — metadata and indexed counts for one video

### Add it to Claude Desktop / Claude Code

For clients that speak Streamable HTTP natively (Claude Code, recent Claude Desktop):

```json
{
  "mcpServers": {
    "long-form-video-search": {
      "type": "streamableHttp",
      "url": "https://acq-search-retrieval.vercel.app/api/mcp"
    }
  }
}
```

For clients still on stdio-only, wrap the remote endpoint via the standard bridge:

```json
{
  "mcpServers": {
    "long-form-video-search": {
      "command": "npx",
      "args": ["-y", "mcp-remote", "https://acq-search-retrieval.vercel.app/api/mcp"]
    }
  }
}
```

Set `MCP_TOKEN` in Vercel env vars to require `Authorization: Bearer <token>`.

## Quickstart (local dev)

```bash
git clone https://github.com/nclawson4/acq_search_retrieval
cd acq_search_retrieval
cp .env.example .env  # fill in keys

# One-time infra setup
cd ingest
python -m venv .venv && source .venv/Scripts/activate   # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python scripts/init_infra.py        # creates Postgres tables + Qdrant collections + payload indexes
python scripts/smoke_test.py        # verifies OpenAI, Qdrant, Neon

# Ingest the corpus
python pipeline.py ../urls.txt      # idempotent on video_id; --force re-ingests

# Run the portal
cd ../web
npm install
vercel env pull .env.local --yes    # pulls Neon / Upstash / Blob from Vercel
npm run dev
```

## Running the eval

```bash
cd web
npx tsx scripts/eval.ts             # synthetic eval over 30 paraphrased segments
npx tsx scripts/eval.ts --n 100     # larger sample
npx tsx scripts/eval.ts --golden    # only curated queries from eval/golden_queries.yaml
```

Writes a report to `web/public/eval-latest.json`. The `/eval` page renders it.

## Env vars

See `.env.example`. Required for ingest: `OPENAI_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`, `DATABASE_URL`. Required for the portal additionally: `KV_REST_API_URL`, `KV_REST_API_TOKEN`, `BLOB_READ_WRITE_TOKEN`. All Marketplace-provisioned vars come from `vercel env pull .env.local --yes`.

## License

MIT.
