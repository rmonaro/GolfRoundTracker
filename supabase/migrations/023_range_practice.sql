-- GPS driving-range practice mode (migration 023).
--
-- Two new tables, kept fully separate from the round/swing tables:
--   range_sessions — one row per practice session at a mat (fixed GPS origin
--                    captured once + a tapped target/aim line).
--   range_shots    — one row per logged ball (one map tap), decomposed into a
--                    carry distance along the target line and a signed offline
--                    distance (+right / -left).
--
-- Distances are stored in METERS (DB is metric); the display layer converts to
-- yards. RLS mirrors the owner-scoped style used on tm_links / swing_sessions:
-- references public.profiles(id) (= the auth user id) and an owner_rw policy.

create table if not exists public.range_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  origin_lat double precision not null,
  origin_lng double precision not null,
  target_lat double precision not null,
  target_lng double precision not null,
  target_bearing double precision not null,   -- degrees 0-360, origin -> target
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.range_shots (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.range_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- INTEGRATION SEAM (deferred): set when a watch swing event is matched.
  -- Null in v1. FK left loose intentionally; wire to a swing_events table in
  -- the next prompt rather than now.
  swing_event_id uuid,

  -- Manual club entry for v1 (until the watch supplies it). Stores the club's
  -- display label. Nullable.
  club text,

  land_lat double precision not null,
  land_lng double precision not null,
  carry_m double precision not null,        -- along the target line
  offline_m double precision not null,      -- + = right of line, - = left
  total_m double precision not null,        -- straight-line origin -> land
  created_at timestamptz not null default now()
);

create index if not exists range_shots_session_idx on public.range_shots(session_id);
create index if not exists range_shots_user_idx on public.range_shots(user_id);
create index if not exists range_sessions_user_idx on public.range_sessions(user_id);

-- RLS: owner-scoped read/write, mirroring the project's existing policy style.
alter table public.range_sessions enable row level security;
alter table public.range_shots enable row level security;

do $$ begin
  drop policy if exists "range_sessions_owner_rw" on public.range_sessions;
  create policy "range_sessions_owner_rw" on public.range_sessions
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

  drop policy if exists "range_shots_owner_rw" on public.range_shots;
  create policy "range_shots_owner_rw" on public.range_shots
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
end $$;
