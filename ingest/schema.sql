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
