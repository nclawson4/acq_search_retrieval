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
