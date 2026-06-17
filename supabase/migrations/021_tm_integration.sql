-- Migration 021 — TournamentManagement (TM) integration
-- Dialect: PostgreSQL (Supabase). Safe to re-run.
--
-- GRT integrates with the TournamentManagement app (separate Supabase project,
-- loosely coupled by shared identifiers — no shared DB). This migration stores
-- the GRT side of the link:
--
--   • grt_athlete_id  = our Supabase auth user id (profiles.id). Nothing new to
--     store for it — it IS the user id we already have.
--   • TM registration_id(s) returned by TM's /link + /entitlements endpoints,
--     persisted per user in `tm_links`.
--   • round_tracking_round_id = our rounds.id (GRT's round id). When a player
--     starts a tournament round we stamp the TM registration + round number on
--     the round so the live-score / shot push knows where to send.

-- ---------------------------------------------------------------------------
-- 1. tm_links — one row per (user, TM registration). Persisted from /link and
--    refreshed from /entitlements. external_course_id lets the UI match the TM
--    course to a local courses.course_api_id without a round-trip.
-- ---------------------------------------------------------------------------
create table if not exists public.tm_links (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  registration_id uuid not null,
  tournament_id uuid,
  tournament_slug text,
  tournament_name text,
  registration_status text,
  external_course_id text,
  division_name text,
  -- Last entitlements snapshot for this registration (rounds, tee times,
  -- can_start, linked scorecards). Lets "My Tournaments" render instantly from
  -- cache and refetch in the background.
  snapshot jsonb,
  linked_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, registration_id)
);

create index if not exists tm_links_user_idx on public.tm_links(user_id);

-- ---------------------------------------------------------------------------
-- 2. rounds — carry the TM linkage so the score/shot push can attribute the
--    round. round_tracking_round_id sent to TM is just rounds.id.
-- ---------------------------------------------------------------------------
alter table public.rounds add column if not exists tm_registration_id uuid;
alter table public.rounds add column if not exists tm_round_number integer;
alter table public.rounds add column if not exists tm_tournament_slug text;

create index if not exists rounds_tm_registration_idx
  on public.rounds(tm_registration_id);

-- ---------------------------------------------------------------------------
-- 3. RLS — tm_links is owner-scoped, same shape as the rest of the schema.
-- ---------------------------------------------------------------------------
alter table public.tm_links enable row level security;

do $$ begin
  drop policy if exists "tm_links_owner_rw" on public.tm_links;
  create policy "tm_links_owner_rw" on public.tm_links
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
end $$;
