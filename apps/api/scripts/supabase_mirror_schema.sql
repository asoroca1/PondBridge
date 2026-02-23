-- Mongo -> Supabase mirror table
-- Run this once in Supabase SQL Editor before enabling SUPABASE_MIRROR_ENABLED=true.

create table if not exists public.pb_mongo_mirror (
  collection text not null,
  id text not null,
  tenant_id text null,
  payload jsonb not null,
  created_at timestamptz null,
  updated_at timestamptz not null default now(),
  synced_at timestamptz not null default now(),
  primary key (collection, id)
);

create index if not exists pb_mongo_mirror_collection_idx
  on public.pb_mongo_mirror (collection);

create index if not exists pb_mongo_mirror_tenant_idx
  on public.pb_mongo_mirror (tenant_id);

create index if not exists pb_mongo_mirror_synced_idx
  on public.pb_mongo_mirror (synced_at desc);
