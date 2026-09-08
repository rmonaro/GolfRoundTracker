-- Migration 041 — Spectator shares (follow an athlete's tournament round live)
-- Dialect: PostgreSQL (Supabase). Safe to re-run.
--
-- A parent or grandparent who does not have a GRT account can watch an athlete
-- play. The athlete generates a code, shares it however they like (it renders
-- as a QR too), and the holder enters it on the login screen. No sign-up, no
-- password — the code IS the credential.
--
-- Scope, deliberately narrow:
--   • TOURNAMENT rounds only. A round with no tm_registration_id is invisible
--     to a spectator, so a casual Saturday round stays private without the
--     athlete having to remember to turn sharing off.
--   • Read only, and served entirely by the `spectator-api` edge function under
--     the service key. Nothing here grants an anonymous Postgres role access to
--     rounds, shots or holes — there are no anon policies in this migration,
--     and that is the point.
--
-- Finding the athlete's rounds goes through tm_links.registration_id, NOT
-- rounds.user_id. In scorer mode (migration 034) a tournament round is owned by
-- the MARKER while it is being played and only transfers to the athlete when it
-- finishes, so matching on user_id would show a spectator nothing until the
-- round was already over — precisely the window they care about.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. spectator_shares — one row per code an athlete has handed out.
--
-- Regenerating revokes the old row and inserts a new one rather than updating
-- in place, so there is a record of which codes were ever live. Rows are never
-- deleted while the athlete exists.
-- ---------------------------------------------------------------------------
create table if not exists public.spectator_shares (
  id uuid primary key default gen_random_uuid(),
  athlete_user_id uuid not null references public.profiles(id) on delete cascade,
  code text not null,
  -- Free text so the athlete can tell two codes apart ("Mum", "Coach").
  label text,
  created_at timestamptz not null default now(),
  -- Null = no expiry. A tournament code is usually left open and revoked later.
  expires_at timestamptz,
  revoked_at timestamptz,
  -- Light usage signal, so an athlete can see the code is actually being used
  -- (and notice if it is being used when it shouldn't be).
  last_viewed_at timestamptz,
  view_count integer not null default 0
);

-- Codes are compared case-insensitively — a grandparent typing "abcd efgh" off
-- a text message must match the "ABCD-EFGH" that was generated.
create unique index if not exists spectator_shares_code_key
  on public.spectator_shares(upper(code));

create index if not exists spectator_shares_athlete_idx
  on public.spectator_shares(athlete_user_id) where revoked_at is null;

-- ---------------------------------------------------------------------------
-- 2. Code generation.
--
-- 8 characters from a 31-character alphabet with the ambiguous glyphs removed
-- (no 0/O, no 1/I/L) — about 8.5e11 combinations, which is far past brute force
-- through an edge function while staying short enough to read down a phone.
-- Displayed grouped as XXXX-XXXX; the dash is presentation only and is stripped
-- before lookup.
--
-- gen_random_bytes rather than random(): random() is a seeded PRNG and its
-- output is predictable from earlier draws, which is not what you want from
-- something that acts as a credential. Bytes at or above 248 are discarded so
-- the modulo doesn't bias the last few letters of the alphabet.
-- ---------------------------------------------------------------------------
create or replace function public.generate_spectator_code()
returns text
language plpgsql
volatile
as $$
declare
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  n constant int := length(alphabet);
  result text := '';
  b int;
begin
  while length(result) < 8 loop
    b := get_byte(gen_random_bytes(1), 0);
    -- 248 = 8 * 31, the largest multiple of the alphabet size under 256.
    if b < 248 then
      result := result || substr(alphabet, 1 + (b % n), 1);
    end if;
  end loop;
  return result;
end $$;

/**
 * Mint a share code for the calling athlete.
 *
 * SECURITY DEFINER only so the retry loop can see the unique index across every
 * athlete's codes; the row it writes is always the caller's own, taken from
 * auth.uid() rather than from an argument, so this cannot be used to create a
 * share for somebody else.
 */
create or replace function public.create_spectator_share(
  p_label text default null,
  p_expires_at timestamptz default null
)
returns public.spectator_shares
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  row public.spectator_shares;
  attempt int := 0;
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  loop
    attempt := attempt + 1;
    begin
      insert into public.spectator_shares (athlete_user_id, code, label, expires_at)
      values (uid, public.generate_spectator_code(), nullif(btrim(p_label), ''), p_expires_at)
      returning * into row;
      return row;
    exception when unique_violation then
      -- Collision on the code index. At this alphabet size it should never
      -- happen; looping a handful of times costs nothing and beats surfacing a
      -- constraint error to the athlete.
      if attempt >= 5 then
        raise;
      end if;
    end;
  end loop;
end $$;

revoke all on function public.create_spectator_share(text, timestamptz) from public;
grant execute on function public.create_spectator_share(text, timestamptz) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. RLS — the athlete manages their own codes and nobody else sees them.
--
-- There is intentionally no policy for `anon`. A spectator never touches this
-- table (or any other) directly: the edge function validates the code with the
-- service key and returns only the round data it decides to return. That keeps
-- the blast radius of a leaked code to "can read one athlete's tournament
-- rounds", enforced in one place that can be read end to end.
-- ---------------------------------------------------------------------------
alter table public.spectator_shares enable row level security;

do $$ begin
  drop policy if exists "spectator_shares_owner_select" on public.spectator_shares;
  create policy "spectator_shares_owner_select" on public.spectator_shares
    for select using (athlete_user_id = auth.uid());

  -- Insert goes through create_spectator_share, but the policy is here so the
  -- table is coherent on its own rather than depending on the function.
  drop policy if exists "spectator_shares_owner_insert" on public.spectator_shares;
  create policy "spectator_shares_owner_insert" on public.spectator_shares
    for insert with check (athlete_user_id = auth.uid());

  -- Update is how a code is revoked or relabelled. Reassigning a share to
  -- another athlete is blocked by the with-check.
  drop policy if exists "spectator_shares_owner_update" on public.spectator_shares;
  create policy "spectator_shares_owner_update" on public.spectator_shares
    for update
    using (athlete_user_id = auth.uid())
    with check (athlete_user_id = auth.uid());
end $$;

comment on table public.spectator_shares is
  'Codes an athlete hands out so family can follow their tournament rounds without an account. Read exclusively through the spectator-api edge function.';
