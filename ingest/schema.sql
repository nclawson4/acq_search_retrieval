-- Multi-modal video search schema.
-- Apply with: psql "$DATABASE_URL" -f ingest/schema.sql
-- Idempotent — safe to re-run.

create table if not exists videos (
    id                text primary key,           -- youtube video id
    url               text not null,
    title             text,
    channel           text,
    duration_s        numeric,
    ingested_at       timestamptz default now(),
    last_indexed_at   timestamptz,
    source_meta       jsonb default '{}'::jsonb
);

create table if not exists segments (
    id                bigserial primary key,
    video_id          text not null references videos(id) on delete cascade,
    start_s           numeric not null,
    end_s             numeric not null,
    text              text not null,
    qdrant_point_id   uuid not null unique
);
create index if not exists segments_video_time_idx on segments(video_id, start_s);

create table if not exists frames (
    id                bigserial primary key,
    video_id          text not null references videos(id) on delete cascade,
    t_s               numeric not null,
    blob_url          text not null,
    qdrant_point_id   uuid not null unique
);
create index if not exists frames_video_time_idx on frames(video_id, t_s);

create table if not exists eval_runs (
    id                bigserial primary key,
    ran_at            timestamptz default now(),
    git_sha           text,
    recall_at_5       numeric,
    recall_at_10      numeric,
    mrr               numeric,
    details           jsonb default '{}'::jsonb
);

-- Q→A moments: paired attendee question + Alex answer extracted via LLM
-- diarization. Replaces the older "segments" abstraction at retrieval time.
create table if not exists moments (
    id                  bigserial primary key,
    video_id            text not null references videos(id) on delete cascade,
    q_start_s           numeric not null,
    q_end_s             numeric not null,
    q_text              text not null,
    a_start_s           numeric not null,
    a_end_s             numeric not null,
    a_text              text not null,
    industry            text,                            -- attendee industry, normalized
    revenue_band        text,                            -- "<$1M" / "$1-5M" / "$5-10M" / "$10M+" / null
    problems            text[] default '{}',             -- normalized problem tags
    audio_quality       numeric,                         -- 0-1, higher is better
    energy_peak         numeric,                         -- 0-1, normalized loudness peak in answer
    clip_score          numeric,                         -- 0-1, composite clip-worthiness
    a_qdrant_point_id   uuid not null unique,
    q_qdrant_point_id   uuid not null unique
);
create index if not exists moments_video_time_idx on moments(video_id, a_start_s);
create index if not exists moments_industry_idx on moments(industry);
create index if not exists moments_revenue_idx on moments(revenue_band);

-- Sessions: one contiguous attendee block + Alex's answers to them.
-- Replaces "moments" as the unit of retrieval for the ICP-driven UX.
-- Shorts = 1 session per video. Long videos = 1 session per attendee.
create table if not exists sessions (
    id                       bigserial primary key,
    video_id                 text not null references videos(id) on delete cascade,
    start_s                  numeric not null,
    end_s                    numeric not null,
    attendee_cluster_id      integer,                          -- Deepgram cluster id; null for shorts
    attendee_gender          text,                             -- "male" / "female" / "unknown"
    industry                 text,                             -- closed-set, see ingest/topics.py
    revenue_band             text,                             -- "<$1M" / "$1-5M" / "$5-25M" / "$25M+" / "unknown"
    topics                   text[] default '{}',              -- 1-3 closed-set tags
    conversation_summary     text,                             -- 1-2 sentence "what this is about"
    full_text                text not null,                    -- all turns concatenated (attendee + alex)
    summary_qdrant_point_id  uuid not null unique,
    created_at               timestamptz default now()
);
create index if not exists sessions_video_idx on sessions(video_id);
create index if not exists sessions_industry_idx on sessions(industry);
create index if not exists sessions_revenue_idx on sessions(revenue_band);
create index if not exists sessions_gender_idx on sessions(attendee_gender);
create index if not exists sessions_topics_idx on sessions using gin(topics);

-- Sessions clustered by conversation identity. Two sessions belong to the
-- same group when their summary embeddings are >= DUP_THRESHOLD cosine
-- similar. At search time the renderer collapses each group to one card,
-- preferring the shorter (more clip-ready) session.
alter table sessions add column if not exists dup_group_id integer;
create index if not exists sessions_dup_group_idx on sessions(dup_group_id);

-- Multi-industry tagging with verification gates. Primary industry is the
-- highest-confidence judgment; secondaries are additional industries the
-- attendee is actively operating in (multi-line business owners). Each tag
-- carries a verbatim evidence quote that must appear in full_text, and is
-- run through an audit pass (separate LLM call, evidence-only context) that
-- can reject overreach. industry_evidence stores the per-industry rationale
-- so an editor can audit the tagging at search time.
alter table sessions add column if not exists secondary_industries text[] default '{}';
alter table sessions add column if not exists industry_evidence jsonb default '{}'::jsonb;
create index if not exists sessions_secondary_industries_idx on sessions using gin(secondary_industries);

-- Separate "play here" timestamp for the YouTube URL. The displayed start_s
-- is the segmentation boundary; play_start_s is start_s minus a small
-- preroll so YouTube's keyframe seek (which jumps forward 1-3s) still lands
-- before the attendee's first word.
alter table sessions add column if not exists play_start_s numeric;

-- Eval gold set: queries with labeled relevant sessions for retrieval scoring.
create table if not exists eval_queries (
    id                  bigserial primary key,
    query_text          text not null,
    expected_industry   text,
    expected_revenue    text,
    expected_topics     text[] default '{}',
    expected_gender     text,
    notes               text,
    created_at          timestamptz default now()
);

create table if not exists eval_labels (
    id              bigserial primary key,
    query_id        bigint not null references eval_queries(id) on delete cascade,
    session_id      bigint not null references sessions(id) on delete cascade,
    relevance       text not null,    -- 'relevant' | 'partial' | 'not_relevant'
    rank            integer,          -- the rank at which this session appeared during labeling
    labeled_at      timestamptz default now(),
    unique (query_id, session_id)
);
create index if not exists eval_labels_query_idx on eval_labels(query_id);

-- Per-query cost + latency telemetry. Drives the daily cost ceiling.
create table if not exists query_log (
    id                  bigserial primary key,
    queried_at          timestamptz default now(),
    query_text          text,
    n_results           integer,
    latency_ms          integer,
    cost_usd            numeric,
    llm_tokens_input    integer,
    llm_tokens_output   integer,
    embed_tokens        integer
);
create index if not exists query_log_time_idx on query_log(queried_at);
