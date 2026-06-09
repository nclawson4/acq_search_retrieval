# Architecture

## Goals

- Editor-grade moment sourcing over a long-form video library
- One natural-language query → ranked, timestamped moments
- Identical retrieval core surfaced via web portal and remote MCP server
- Public, shareable, rate-limited; no login

## Data flow

```
                       ┌─────────────────────────────┐
                       │  Ingest (Python CLI, local) │
                       │                             │
   urls.txt ──────────▶│  yt-dlp ──▶ mp4 + m4a       │
                       │  Whisper API ──▶ transcript │
                       │  scenedetect ──▶ keyframes  │
                       │  text-embed ──▶ seg vectors │
                       │  open CLIP ──▶ frame vectors│
                       └────┬────────────┬───────────┘
                            │            │
                     vectors│            │metadata + thumbnails
                            ▼            ▼
                    ┌────────────┐  ┌─────────────────────┐
                    │ Qdrant     │  │ Neon Postgres       │
                    │ segments   │  │ videos              │
                    │ frames     │  │ segments            │
                    └─────┬──────┘  │ frames              │
                          │         │ eval_runs           │
                          │         └──────────┬──────────┘
                          │                    │
                          │                    │
                          └─────────┬──────────┘
                                    │
                                    ▼
                      ┌──────────────────────────────┐
                      │ Next.js (web/) on Vercel     │
                      │                              │
                      │  /             search UI     │
                      │  /api/search   route handler │
                      │  /api/mcp      Streamable MCP│
                      │  /eval         dashboard     │
                      └──────────────┬───────────────┘
                                     │
                                     ▼
                       Upstash Redis (rate limit + global cap)
```

## Embedding choices and why

- **Transcript: `text-embedding-3-small` (1536-d)**. Strong text retrieval at very low cost. Single provider for query embedding keeps runtime simple.
- **Frames: open CLIP `ViT-L-14` (LAION-2B, 768-d)**. Free and self-hosted, identical text-encoder used at query time enables cross-modal retrieval. `ViT-H-14` is marginally better but ~3× compute; not worth it.
- **Cross-modal retrieval**: the two indexes are searched independently with the same text query (one OpenAI embed, one CLIP-text embed). Scores normalize per-collection, merged with a weighted sum (transcript 0.7, frame 0.3 default — tunable), then de-duplicated within a 10 s window.

## Segmentation

- Whisper API returns word-level timestamps via `timestamp_granularities=['word']` (verbose_json).
- Segments: ~30 s windows with 5 s overlap, snapped to nearest sentence boundary (`.`, `?`, `!`) within ±5 s.
- Each segment stores: video_id, start_s, end_s, text, vector.

## Keyframes

- PySceneDetect `ContentDetector` (threshold 27 default). One representative frame per scene at the middle timestamp.
- Frames written as 384×216 (or native aspect, capped to 600px wide) JPEG to keep blob storage and CLIP inference cheap.
- Each frame stores: video_id, t_s, blob_url, vector.

## Postgres schema

```sql
create table videos (
  id            text primary key,         -- youtube video id
  url           text not null,
  title         text,
  channel       text,
  duration_s    numeric,
  ingested_at   timestamptz default now(),
  last_indexed_at timestamptz,
  source_meta   jsonb
);

create table segments (
  id            bigserial primary key,
  video_id      text references videos(id) on delete cascade,
  start_s       numeric not null,
  end_s         numeric not null,
  text          text not null,
  qdrant_point_id uuid not null
);
create index on segments(video_id, start_s);

create table frames (
  id            bigserial primary key,
  video_id      text references videos(id) on delete cascade,
  t_s           numeric not null,
  blob_url      text not null,
  qdrant_point_id uuid not null
);
create index on frames(video_id, t_s);

create table eval_runs (
  id            bigserial primary key,
  ran_at        timestamptz default now(),
  git_sha       text,
  recall_at_5   numeric,
  recall_at_10  numeric,
  mrr           numeric,
  details       jsonb
);
```

## Qdrant collections

- `segments`: vector size 1536, cosine, payload `{ video_id, start_s, end_s }`.
- `frames`: vector size 768, cosine, payload `{ video_id, t_s }`.

Payload is intentionally minimal; the heavy fields (text, blob_url) live in Postgres and are joined at result-time.

## MCP tool surface

- `search_moments(query: string, k?: number = 10, video_id?: string)` → ranked moments.
- `get_video(video_id: string)` → video metadata + segment count.

Deliberately small. Adding tools only after eval shows necessity.

## Rate limiting

- Per-IP, sliding window: 30 req/min.
- Global daily ceiling: 10,000 req/day. Once hit, search returns a static "demo limit reached" message until UTC midnight.
- Implemented in middleware for both `/api/search` and `/api/mcp`.

## Eval

- `eval/golden_queries.yaml`: ~30 queries with expected `{video_id, t_min, t_max, notes}`.
- `eval/runner.py`: runs each through `/api/search` (or the underlying lib), computes recall@5, recall@10, MRR.
- Results written to `eval/results/<timestamp>.json`, latest copied to `web/public/eval-latest.json`. `/eval` page renders it.
