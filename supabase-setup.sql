-- Run this once in Supabase: Project -> SQL Editor -> New query -> paste -> Run

create table if not exists dnl_kv (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz default now()
);

alter table dnl_kv enable row level security;

-- This app has no per-user login (captains use a simple code checked in the
-- app itself), so every device needs to read/write freely with the public
-- Publishable key. That matches the same trust model the Claude-hosted version
-- used. Anyone who has the Publishable key (visible in the deployed site's code,
-- same as any client-side Supabase app) could read or write this table --
-- fine for a one-night trusted event, not something to reuse for sensitive data.

create policy "public read" on dnl_kv for select using (true);
create policy "public insert" on dnl_kv for insert with check (true);
create policy "public update" on dnl_kv for update using (true);
create policy "public delete" on dnl_kv for delete using (true);
