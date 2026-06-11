# Workshop Q&A Clip Finder

A production-grade AI-native search and retrieval system over a 500+ minute long-form Q&A workshop library. A non-technical editor types something like *"med spa owners under $5M trying to scale"* and the system returns ranked, timestamped attendee sessions ready to drop into an edit.

The same retrieval surface is exposed three ways: a web portal for editors, a JSON API for internal tooling, and an MCP server for AI agents.

![Demo screenshot](docs/demo.png)
> Drop a screen-capture GIF of the homepage at `docs/demo.gif` to replace this still.

---

## Table of contents

1. [What it does](#what-it-does)
2. [Why this design](#why-this-design)
3. [Architecture](#architecture)
4. [Ingest pipeline](#ingest-pipeline)
5. [Search pipeline](#search-pipeline)
6. [Evaluation and monitoring](#evaluation-and-monitoring)
7. [Stack](#stack)
8. [Local development](#local-development)
9. [Deployment](#deployment)
10. [Costs](#costs)
11. [Security model](#security-model)
12. [Project structure](#project-structure)

---

## What it does

The corpus is a library of long-form workshop videos where one host fields questions from a rotating cast of business owners. Each video contains multiple attendee Q&A sessions back-to-back, with no chapter markers.

The system:

- Splits each video into individual attendee sessions using voice fingerprinting plus speaker-cluster boundary detection.
- Tags each session with structured attributes the host team actually filters on (industry, revenue band, attendee gender, conversation topics, summary, audit-verified quote).
- Indexes every session into Qdrant with an OpenAI text embedding plus the structured filters as payload.
- Serves a hybrid retrieval surface: natural-language filter extraction, dense vector retrieval, structured-filter intersection, and a final LLM re-ranker.

The editor never sees the pipeline. They type a query, get back a list of clips, click play, YouTube opens at the right second.

## Why this design

Three design decisions drive everything:

**Sessions, not segments.** The unit of retrieval is one attendee's full Q&A turn, not a transcript chunk. Editors think in "find me the restaurant guy", not "find me 30 seconds about pricing". Boundary detection is voice-clustered, not topic-clustered, so two attendees discussing the same problem still come back as two separate results.

**Structured filters as first-class citizens.** Free-text RAG over this corpus collapses to mush because every session sounds similar (host + business owner discussing growth problems). A small LLM extracts industry, revenue band, gender, and topics from the query and applies them as hard payload filters in Qdrant. The remaining residual text drives the dense retrieval. This is what makes "med spa owners doing under $5M" return only med spa owners doing under $5M.

**Audit gate on the tagger.** The auto-tagger has a verifier pass: it must produce a verbatim quote from the transcript supporting each industry tag, then a separate LLM judges whether the quote actually supports the tag. Sessions that fail the audit fall back to "other" rather than poisoning the index with hallucinated tags.

## Architecture

```
                       ┌──────────────────────────────────────┐
                       │           Web (Next.js 16)           │
                       │  • / homepage (server component)     │
                       │  • Mobile + desktop animated demos   │
                       │  • IP-count gate (5 free per 24h)    │
                       │  • Login (cookie-based bypass)       │
                       │  • /api/mcp (MCP server)             │
                       └────────────┬─────────────────────────┘
                                    │
                         ┌──────────┴──────────┐
                         ▼                     ▼
            ┌─────────────────────┐   ┌─────────────────────┐
            │   Search pipeline   │   │     MCP tools       │
            │   (lib/sessions.ts) │   │  (lib/search.ts)    │
            └──────────┬──────────┘   └──────────┬──────────┘
                       │                          │
        ┌──────────────┼──────────────┐          │
        ▼              ▼              ▼          ▼
   ┌─────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐
   │ OpenAI  │   │  Qdrant  │   │   Neon   │   │ Upstash  │
   │ embed + │   │  vector  │   │ Postgres │   │  Redis   │
   │ judge   │   │  search  │   │ (truth)  │   │ (rate)   │
   └─────────┘   └──────────┘   └──────────┘   └──────────┘
                       ▲
                       │
          ┌────────────┴────────────┐
          │     Ingest pipeline     │
          │       (Python)          │
          │  yt-dlp -> Deepgram ->  │
          │  Resemblyzer -> session │
          │  boundaries -> Claude   │
          │  tagger -> audit gate   │
          │  -> embed -> upsert     │
          └─────────────────────────┘
```

## Ingest pipeline

`ingest/` is a Python pipeline organized as discrete stages so each can be re-run independently.

| Stage | Module | Output |
|---|---|---|
| Fetch | `stages/fetch.py` | Raw audio + video metadata via `yt-dlp` |
| Transcribe | `stages/transcribe.py` | Deepgram nova-3 word-level timestamps + speaker clusters |
| Voice fingerprint | `stages/diarize.py` | Resemblyzer compares each cluster to a reference clip of the host. Voice-match band widened so split host clusters both score as host |
| Session boundaries | `stages/sessions.py` | Per-video session start/end derived from cluster transitions, with hand-verified `boundary_overrides.py` for the 4 long-form videos |
| Frame extraction | `stages/frames.py` | One representative frame per session at `start_s + 200/23.976s` |
| Tag | `stages/tag_session_v2.py` | Claude Sonnet 4.6 emits industry, revenue, gender, topics, summary, plus a verbatim supporting quote |
| Audit | `stages/tag_session_v2.py` | Separate Claude call judges whether the quote supports each tag. Failed tags fall back to `other` |
| Embed | `vectors.py` | OpenAI `text-embedding-3-small` over the residual session text + summary |
| Upsert | `vectors.py` | Qdrant points keyed by `session_id` with structured payload |
| Dedupe | `scripts/dedupe_sessions.py` | Cross-video summary-embedding similarity clusters near-duplicate sessions into `dup_group_id` |

The ingest pipeline writes ground-truth metadata to Neon Postgres and vector embeddings to Qdrant Cloud. Postgres is the source of truth for filters and metadata; Qdrant is the dense retrieval index.

## Search pipeline

`web/lib/sessions.ts` orchestrates the runtime search.

```
NL query
   │
   ▼
[1] extractFilters (gpt-4o-mini, structured-output JSON schema)
   │ {industry, revenueBands[], gender, topics[], residualText}
   ▼
[2] embed (text-embedding-3-small over residualText OR raw query)
   │
   ▼
[3] Qdrant search with hard payload filter on industry/revenue/gender/topics
   │ topK = 20 candidates
   ▼
[4] LLM judge pass (gpt-4o-mini) scores each candidate 0..1
   │ for "is this what the editor asked for"
   ▼
[5] Collapse: same-video same-cluster, then cross-video dup_group_id
   │
   ▼
[6] Render: timestamped session cards with YouTube deep-link (?t=start_s-1)
```

Per-query cost averages **$0.0013** at production prices ($0.15 / $0.60 per 1M tokens on gpt-4o-mini, $0.02 / 1M on embeddings). Five free anonymous queries cost about $0.0065 in OpenAI spend before the password gate kicks in.

## Evaluation and monitoring

- **Golden set** lives at `eval/golden_queries.yaml`. Each query lists expected `(video_id, t_min, t_max)` tuples that any reasonable retrieval should surface.
- `scripts/eval.ts` runs the golden set plus 30 random paraphrased queries and reports recall@5, recall@10, and MRR. The latest report is written to `web/public/eval-latest.json` and rendered at `/eval` (dev-only, gated by `ENABLE_DEV_ROUTES`).
- **Per-query cost telemetry** is logged to `query_log` in Postgres. A rolling 24h sum feeds the `DAILY_COST_CEILING_USD` circuit breaker on `/api/search/sessions`.
- **Rate limiting**: Upstash sliding-window 30 req/min per IP and fixed 10k/day global, enforced in `proxy.ts`.
- **IP-count free tier**: anonymous IPs get 5 free searches per 24h (`lib/searchGate.ts`) before being redirected to `/login`. The password unlocks unlimited searches via a 30-day cookie.

## Stack

**Ingest pipeline** (Python 3.11)
- `yt-dlp`, `ffmpeg`, Deepgram nova-3
- Resemblyzer for speaker fingerprinting
- Anthropic Claude Sonnet 4.6 (tagger + audit)
- OpenAI `text-embedding-3-small` (vector index)

**Web** (Next.js 16, React 19, Tailwind v4)
- Server components for the home page and result rendering
- Client components for the animated hero and progress UI
- Liquid-glass search animation with phased state machine (`requestAnimationFrame`)

**Storage**
- Neon Postgres (sessions, videos, query_log, eval_queries, eval_labels)
- Qdrant Cloud (dense vector index, structured payload filters)
- Vercel Blob (extracted frames)
- Upstash KV / Vercel KV (rate limiting + IP-count gate)

**Inference**
- OpenAI `gpt-4o-mini` for filter extraction, LLM judge, residual paraphrasing
- OpenAI `text-embedding-3-small` for retrieval embeddings
- Anthropic Claude Sonnet 4.6 for the ingest-time tagger + audit (one-time per session)

**Agent interface**
- `@modelcontextprotocol/sdk` server at `/api/mcp` exposes `search_sessions` and `search_moments` tools. Bearer-token gated by `MCP_TOKEN`.

## Local development

Prerequisites:
- Node 22+, Python 3.11+, ffmpeg
- OpenAI, Anthropic, Deepgram, Qdrant Cloud accounts
- Neon Postgres + Vercel KV (or Upstash Redis directly)

```bash
# 1. Clone and install
git clone https://github.com/nclawson4/acq_search_retrieval.git
cd acq_search_retrieval
cp .env.example .env
# fill in keys

# 2. Web app
cd web
npm install
cp ../.env .env.local
# set ENABLE_DEV_ROUTES=1 in .env.local to expose /eval, /v/[id], and dev APIs
npm run dev
```

Optional: run the ingest pipeline against a fresh batch of videos:

```bash
cd ingest
pip install -r requirements.txt
python pipeline.py --urls ../urls.txt
python scripts/populate_sessions.py
python scripts/retag_sessions_v2.py
```

Run the eval harness:

```bash
cd web
npx tsx scripts/eval.ts --golden
```

## Deployment

The web app deploys to Vercel as a Next.js project. The ingest pipeline is intended to run on developer machines or a dedicated worker; it's not designed for serverless.

Vercel configuration:

1. Connect the repo.
2. Project root: `web/`.
3. Attach a Neon Postgres database and a Vercel KV store. Both auto-inject the required env vars (`DATABASE_URL`, `KV_REST_API_URL`, `KV_REST_API_TOKEN`).
4. Add the remaining env vars from `.env.example` in the Vercel dashboard. **Do not set `ENABLE_DEV_ROUTES`** in production.
5. Set `DEMO_PASSWORD` to any string. This is the password presented after the IP free-tier is exhausted.

The first deploy provisions the database schema via `ingest/schema.sql`. Run this against the Neon database before the first search.

Production build is verified clean:

```
Route (app)
┌ ƒ /                        (dynamic, server-rendered)
├ ƒ /api/eval/*              (dev-gated, 404 unless ENABLE_DEV_ROUTES=1)
├ ƒ /api/login               (public)
├ ƒ /api/mcp                 (MCP_TOKEN gated)
├ ƒ /api/search*             (dev-gated)
├ ƒ /api/status              (public, health)
├ ○ /eval                    (dev-gated via layout)
├ ƒ /login                   (public)
└ ƒ /v/[id]                  (dev-gated)
```

## Costs

Indicative production costs at OpenAI list pricing:

| Item | Unit | Per-query cost |
|---|---|---|
| Embed query | ~30 input tokens | $0.0000006 |
| Filter extract | 530 in / 100 out | $0.00014 |
| LLM judge (×20 candidates) | 5,000 in / 600 out | $0.00111 |
| **Total per query** |  | **~$0.0013** |

| Item | One-time cost (per session) |
|---|---|
| Ingest tagger + audit (Claude Sonnet 4.6) | ~$0.005 |
| Session embedding | ~$0.000005 |

At the current corpus size (~71 sessions across 55 videos, 9.2 hours), full re-ingest costs about $0.40 in inference plus Deepgram transcription minutes.

## Security model

- **No secrets in the repo**. `.env*` is gitignored; `.env.example` documents every required variable.
- **Prompt injection mitigation** at `web/lib/extract.ts`: the editor's free-text query is passed inside `<query>` XML tags with explicit instructions to treat its contents as data, never as instructions. The structured output schema acts as a second containment layer.
- **Constant-time password compare** in the login API (`web/app/api/login/route.ts`) to avoid timing-leak signal on a single-credential demo.
- **Cookie flags**: `httpOnly`, `sameSite=lax`, `secure` when HTTPS. 30-day rolling expiry.
- **Internal routes** (`/eval`, `/v/[id]`, `/api/eval/*`, `/api/search*`) are gated server-side by `ENABLE_DEV_ROUTES`. The home page does not depend on any of them.
- **Rate limits** at the proxy layer (`web/proxy.ts`): 30 req/min per IP, 10k/day global. Anonymous search count is per-IP, per-day, stored in Redis with a 24-hour TTL.

## Project structure

```
acq_search_retrieval/
├── ingest/                  # Python pipeline (offline)
│   ├── pipeline.py          # Top-level orchestrator
│   ├── stages/              # fetch, transcribe, diarize, sessions, frames, tag
│   ├── scripts/             # populate_sessions, retag_sessions, dedupe
│   ├── boundary_overrides.py
│   └── schema.sql           # Neon Postgres schema
│
├── web/                     # Next.js 16 app
│   ├── app/
│   │   ├── page.tsx         # Home (server component, IP-gated search)
│   │   ├── login/           # Cookie-based password unlock
│   │   ├── eval/            # Golden-set dashboard (dev-only)
│   │   ├── v/[id]/          # Per-video moments debug (dev-only)
│   │   └── api/
│   │       ├── mcp/         # MCP server (search_sessions, search_moments)
│   │       ├── search*/     # JSON search endpoints (dev-only)
│   │       ├── login/       # Auth cookie issuer
│   │       └── status/      # Health check
│   ├── components/
│   │   ├── HeroAnimation.tsx        # Desktop animated demo
│   │   ├── MobileHeroAnimation.tsx  # Mobile cross-fade demo
│   │   └── SearchProgressBar.tsx    # Stage-by-stage progress overlay
│   ├── lib/
│   │   ├── sessions.ts      # Main search pipeline
│   │   ├── search.ts        # Per-moment search (used by MCP)
│   │   ├── extract.ts       # NL filter extraction
│   │   ├── searchGate.ts    # IP-count free tier
│   │   ├── env.ts           # Typed env access + devRoutesEnabled()
│   │   └── taxonomy.ts      # Industry / revenue / topic / gender enums
│   ├── proxy.ts             # Next.js 16 middleware (rate limit)
│   └── scripts/
│       ├── eval.ts          # Golden-set + paraphrase eval harness
│       └── hero_queries.ts  # Helper that runs the demo queries
│
├── eval/
│   └── golden_queries.yaml  # Hand-labeled retrieval ground truth
│
└── .env.example
```

## License

MIT.
