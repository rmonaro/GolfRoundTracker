-- User-drawn aim targets for the GPS Range mode (greens / spots out on the
-- range). A target is a circle (center + radius) or a freeform polygon. Each is
-- anchored to the mat origin where it was created so it can be reloaded when the
-- user returns to ~the same range.
create table if not exists public.range_targets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  label text,
  kind text not null,                    -- 'circle' | 'polygon'
  anchor_lat double precision not null,  -- mat origin where created (for reuse)
  anchor_lng double precision not null,
  center_lat double precision,           -- circle center
  center_lng double precision,
  radius_m double precision,             -- circle radius (meters)
  points jsonb,                          -- polygon ring: [[lng,lat], ...]
  created_at timestamptz not null default now()
);

create index if not exists range_targets_user_idx on public.range_targets(user_id);

alter table public.range_targets enable row level security;

do $$ begin
  drop policy if exists "range_targets_owner_rw" on public.range_targets;
  create policy "range_targets_owner_rw" on public.range_targets
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
end $$;
