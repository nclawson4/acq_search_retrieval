# acq_search_retrieval

Multi-modal search and retrieval over a long-form video library. The same retrieval core is surfaced two ways:

- A simple web search portal
- A remote MCP server (Streamable HTTP) usable from any MCP-compatible client

The intent is editor-grade sourcing: given a natural-language query, return ranked, timestamped moments that combine what was said (transcript) and what was on screen (visual).

## What it indexes

For every video in the corpus:

- **Transcript segments** — Whisper word-level timestamps, windowed into ~30 s overlapping segments, embedded with `text-embedding-3-small`.
- **Keyframes at scene changes** — extracted with PySceneDetect, embedded with open CLIP `ViT-L-14`.

At query time both indexes are searched. Results are merged and de-duplicated by time proximity.

## Why multi-modal

Transcript search finds the idea. Frame search finds the shot. Thumbnail and B-roll work is a visual problem; transcript-only retrieval can't reach it. Audio (energy / tone) is a planned third modality.

## Stack

| Layer | Tool |
| --- | --- |
| Ingest | Python 3.12, yt-dlp, ffmpeg, scenedetect, OpenAI Whisper API, open-clip-torch |
| Vector store | Qdrant Cloud |
| Metadata store | Neon Postgres |
| Object storage | Vercel Blob (frame thumbnails) |
| Portal + MCP | Next.js 16 App Router on Vercel |
| Rate limiting | Upstash Redis |
| Eval | Golden queries → recall@k + MRR, rendered at `/eval` |

## Layout

```
web/      Next.js portal + MCP HTTP endpoint
ingest/   Python ingestion pipeline (CLI)
eval/     Golden queries + retrieval eval runner
docs/     Architecture notes
```

## Quickstart

```bash
git clone https://github.com/nclawson4/acq_search_retrieval
cd acq_search_retrieval
cp .env.example .env  # fill in keys (see Env vars below)

# Ingest
cd ingest
python -m venv .venv && source .venv/bin/activate   # on Windows: .venv\Scripts\activate
pip install -r requirements.txt
python -m pipeline ../urls.txt

# Portal
cd ../web
npm install
npm run dev
```

The portal will be at `http://localhost:3000`. The MCP endpoint is at `http://localhost:3000/api/mcp`.

## Env vars

See `.env.example` for the full list. Required for ingest: `OPENAI_API_KEY`, `QDRANT_URL`, `QDRANT_API_KEY`, `DATABASE_URL`. Required for the portal: same set plus `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`, `BLOB_READ_WRITE_TOKEN`.

## License

MIT (planned).
