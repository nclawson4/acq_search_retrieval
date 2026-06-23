# Architecture

## Goals

- Editor-grade moment sourcing over a long-form video library
- One natural-language query → ranked, timestamped moments
- Identical retrieval core surfaced via web portal and remote MCP server
- Rate-limited, with a login gate: anonymous IPs get a small free-search allowance per 24h, then a password unlocks unlimited searches; the JSON search routes are dev-gated

## Data flow

```
                       ┌─────────────────────────────┐
                       │  Ingest (Python CLI, local) │
                       │                             │
   urls.txt ──────────▶│  yt-dlp ──▶ mp4 + m4a       │
                       │  Deepgram nova-3 ──▶ transcript │
                       │  scenedetect ──▶ keyframes  │
                       │  text-embed ──▶ session vec │
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
                      │  /login        password gate │
                      │  /api/mcp      Streamable MCP│
                      │  /api/search   route (dev)   │
                      │  /eval         dashboard (dev)│
                      └──────────────┬───────────────┘
                                     │
                                     ▼
                       Upstash Redis (rate limit + global cap)
```

## Embedding choices and why

- **Session text: `text-embedding-3-small` (1536-d)**. Strong text retrieval at very low cost. Single provider for query embedding keeps runtime simple.
- **Text-only retrieval**: the index is a single dense collection over session text (residual query text + summary). Keyframes are extracted per scene for thumbnails but are not embedded — there is no CLIP frame-vector index and no cross-modal merge.

## Segmentation

- Deepgram nova-3 returns word-level timestamps (and speaker clusters) for each transcript.
- Segments: ~30 s windows with 5 s overlap, snapped to nearest sentence boundary (`.`, `?`, `!`) within ±5 s.
- Each segment stores: video_id, start_s, end_s, text, vector.

## Keyframes

- PySceneDetect `ContentDetector` (threshold 27 default). One representative frame per scene at the middle timestamp.
- Frames written as 384×216 (or native aspect, capped to 600px wide) JPEG to keep blob storage cheap. Frames are thumbnails only; they are not embedded.
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

- `search_moments(query: string, k?: number = 10, video_id?: string, speaker?: "answer" | "question" | "both", industry?: string, revenue_band?: string, problems?: string[], min_audio_quality?: number)` → ranked Q&A moments.
- `get_video(video_id: string)` → video metadata + `moment_count` + `frame_count`.

Deliberately small. Adding tools only after eval shows necessity.

## Rate limiting

- Per-IP, sliding window: 30 req/min.
- Global daily ceiling: 10,000 req/day. Once hit, search returns a static "demo limit reached" message until UTC midnight.
- Implemented at the proxy/middleware layer (`web/proxy.ts`), covering the homepage search path and `/api/mcp`; the JSON `/api/search*` routes are dev-gated.

## Eval

- `eval/golden_queries.yaml`: ~30 queries with expected `{video_id, t_min, t_max, notes}`.
- `eval/runner.py`: runs each through `/api/search` (or the underlying lib), computes recall@5, recall@10, MRR.
- Results written to `eval/results/<timestamp>.json`, latest copied to `web/public/eval-latest.json`. `/eval` page renders it.
