-- Migration 045 — Spectator follows (a code, remembered against an account)
-- Dialect: PostgreSQL (Supabase). T-SQL linter false-positives expected.
-- Safe to re-run.
--
-- A spectator with no account has exactly one thing: the code, in localStorage
-- on one phone. Clear the app's data, change handset, or watch a second athlete
-- and it is gone — they have to ask for the code again. This lets them keep it.
--
-- WHAT AN ACCOUNT DOES AND DOES NOT BUY. It saves CODES, nothing more. A
-- follower still reads through the `spectator-api` edge function exactly as an
-- anonymous viewer does, and still sees TOURNAMENT rounds only. No policy here
-- grants anybody read access to `rounds`, `round_holes` or `shots` — the
-- privacy model of migration 041 is untouched, deliberately, because "my
-- daughter's parent account can see her casual Saturday round" is a different
-- decision from "a code shows tournament play" and is not one to make by
-- accident.
--
-- The consequence worth stating: the ATHLETE stays in control. Revoking a code
-- cuts off every follower holding it at their next poll, saved or not. A follow
-- is a bookmark, not a grant.

create table if not exists public.spectator_follows (
  id uuid primary key default gen_random_uuid(),
  follower_user_id uuid not null references public.profiles(id) on delete cascade,
  share_id uuid not null references public.spectator_shares(id) on delete cascade,
  -- Denormalised so the list renders without joining profiles, and so a follow
  -- still reads sensibly after the athlete revokes (the row survives, the
  -- access does not).
  athlete_name text,
  created_at timestamptz not null default now(),
  -- Following the same code twice is the same follow.
  unique (follower_user_id, share_id)
);

-- The list query is always "my follows"; the FK to shares needs its own index
-- for the cascade (see migration 043 for why an unindexed FK is worth closing).
create index if not exists spectator_follows_follower_idx
  on public.spectator_follows(follower_user_id, created_at desc);
create index if not exists spectator_follows_share_idx
  on public.spectator_follows(share_id);

alter table public.spectator_follows enable row level security;

do $$ begin
  drop policy if exists "spectator_follows_owner" on public.spectator_follows;
  -- A follower manages their own bookmarks and nobody else's. Note there is no
  -- policy for the ATHLETE: who has bookmarked a code is not something the
  -- athlete can enumerate, which keeps this from becoming a follower list.
  create policy "spectator_follows_owner" on public.spectator_follows
    for all
    using (follower_user_id = auth.uid())
    with check (follower_user_id = auth.uid());
end $$;

-- ---------------------------------------------------------------------------
-- follow_spectator_share — save a code to the caller's account.
--
-- SECURITY DEFINER because a follower cannot read `spectator_shares` (that
-- table is athlete-only by design), so resolving a code to a share id has to
-- happen in a function that can. The caller supplies a code and gets back their
-- own follow row: there is no way to use this to read somebody else's shares,
-- and no way to create a follow for another user — follower_user_id comes from
-- auth.uid(), never from an argument.
-- ---------------------------------------------------------------------------
create or replace function public.follow_spectator_share(p_code text)
returns public.spectator_follows
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  uid uuid := auth.uid();
  bare text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  s public.spectator_shares;
  name text;
  row public.spectator_follows;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  select * into s
  from public.spectator_shares
  where code = bare
    and revoked_at is null
    and (expires_at is null or expires_at > now());

  -- Same message whichever way it failed. A code that was revoked and a code
  -- that never existed are indistinguishable to the holder on purpose.
  if s.id is null then
    raise exception 'That code is not valid';
  end if;

  select nullif(trim(coalesce(p.first_name, '') || ' ' || coalesce(p.last_name, '')), '')
    into name
  from public.profiles p
  where p.id = s.athlete_user_id;

  insert into public.spectator_follows (follower_user_id, share_id, athlete_name)
  values (uid, s.id, name)
  on conflict (follower_user_id, share_id)
    -- Refresh the cached name rather than doing nothing, so a follow saved
    -- before the athlete filled in their profile stops reading "Unknown".
    do update set athlete_name = excluded.athlete_name
  returning * into row;

  return row;
end $$;

-- ---------------------------------------------------------------------------
-- list_spectator_follows — the caller's saved athletes, with the code back.
--
-- Returning the code is not a leak: the follower already had it, and it is the
-- only thing that makes the saved follow usable — every read still goes through
-- the edge function, which re-validates on every poll.
-- ---------------------------------------------------------------------------
create or replace function public.list_spectator_follows()
returns table (
  id uuid,
  code text,
  athlete_name text,
  created_at timestamptz,
  -- Surfaced rather than filtered out: a follow whose code the athlete has
  -- retired should say so, not silently vanish and leave the follower
  -- wondering where their person went.
  revoked boolean
)
language sql
security definer
set search_path = public, extensions
as $$
  select f.id,
         s.code,
         f.athlete_name,
         f.created_at,
         (s.revoked_at is not null
           or (s.expires_at is not null and s.expires_at <= now())) as revoked
  from public.spectator_follows f
  join public.spectator_shares s on s.id = f.share_id
  where f.follower_user_id = auth.uid()
  order by f.created_at desc;
$$;

grant execute on function public.follow_spectator_share(text) to authenticated;
grant execute on function public.list_spectator_follows() to authenticated;

-- Verify (in the SQL editor, borrowing an identity — see migration 044):
--   begin;
--   select set_config('request.jwt.claims',
--                     json_build_object('sub', '<follower-uuid>')::text, true);
--   select * from public.follow_spectator_share('K7MT-Q4XB');
--   select * from public.list_spectator_follows();
--   rollback;
