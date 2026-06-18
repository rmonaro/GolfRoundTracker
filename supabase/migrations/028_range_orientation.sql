-- Remembered range aim direction (migration 028).
--
-- The range UI auto-aims north, but real ranges face any direction. The user can
-- drag the aim line to point down their range and "lock" it; we save that bearing
-- anchored to the mat origin so it auto-loads next time they practice there.
--
-- One row per mat area per user (we upsert the nearest within a small radius).
-- Bearing is degrees 0-360, origin -> down-range.

create table if not exists public.range_orientations (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  anchor_lat double precision not null,
  anchor_lng double precision not null,
  bearing double precision not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists range_orientations_user_idx on public.range_orientations (user_id);

alter table public.range_orientations enable row level security;

do $$ begin
  drop policy if exists "range_orientations_owner_rw" on public.range_orientations;
  create policy "range_orientations_owner_rw" on public.range_orientations
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
end $$;
