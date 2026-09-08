-- Migration 042 — Super admins
-- Dialect: PostgreSQL (Supabase). Safe to re-run.
--
-- Two tiers instead of one:
--   • admin        — everything the admin panel does: courses, rounds, users,
--                    imports, merges. What `is_admin` has always meant.
--   • super admin  — the same, PLUS the ability to grant and revoke admin.
--
-- Before this, `is_admin` could only be changed by the service role, so adding
-- an admin meant opening the Supabase dashboard. That is safe but it is not a
-- feature, and it means the person who can add admins is whoever happens to
-- hold the service key.
--
-- SUPER ADMIN IS NOT SELF-SERVICE. `is_super_admin` itself remains
-- service-role-only: a super admin can mint admins but not peers. That keeps a
-- compromised or careless super-admin account from quietly cloning itself, and
-- promoting a second super admin stays a deliberate act at the database. Change
-- the guard below if that ever becomes too strict.

-- ---------------------------------------------------------------------------
-- 1. The flag.
-- ---------------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_super_admin boolean not null default false;

-- Partial: almost every row is false, and every read is "is this one true?".
create index if not exists profiles_super_admin_idx
  on public.profiles(id) where is_super_admin;

-- Bootstrap. Every existing admin becomes a super admin — at the time of
-- writing there is exactly one, the account that has been administering the
-- app. Somebody has to be able to grant the first admin, and a feature that
-- ships with no way to reach it is not shipped.
-- Guarded so a re-run is genuinely a no-op. Without the NOT EXISTS, running
-- this again after a super admin had granted somebody ordinary admin would
-- silently promote that person to super admin too.
update public.profiles
   set is_super_admin = true
 where is_admin = true
   and not exists (select 1 from public.profiles where is_super_admin);

comment on column public.profiles.is_super_admin is
  'Can grant and revoke admin access. Implies is_admin (see public.is_admin). Only the service role can set this.';

-- ---------------------------------------------------------------------------
-- 2. Helpers.
--
-- `is_admin` now answers true for super admins STRUCTURALLY rather than relying
-- on both columns being kept in step. Every existing policy and edge function
-- calls this, so a super admin gains admin rights everywhere without a single
-- policy being touched — and cannot end up locked out of the panel by a row
-- where is_admin was cleared.
-- ---------------------------------------------------------------------------
create or replace function public.is_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_admin or is_super_admin from public.profiles where id = uid),
    false
  )
$$;

create or replace function public.is_super_admin(uid uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select is_super_admin from public.profiles where id = uid),
    false
  )
$$;

-- ---------------------------------------------------------------------------
-- 3. Write guard on both flags.
--
-- Replaces `prevent_self_admin_promotion` from migration 007, which blocked ANY
-- authenticated change to is_admin. That was the right rule when the service
-- role was the only grantor; now a super admin is too.
--
--   is_super_admin  → service role only, always.
--   is_admin        → service role, or a super admin acting on someone else.
--
-- The self check matters: without it a super admin could clear their own
-- is_admin, and while `is_admin()` above would keep letting them in, the row
-- would say something untrue. Demoting yourself out of the tier that lets you
-- promote people is also how an app ends up with no administrators at all.
-- ---------------------------------------------------------------------------
create or replace function public.guard_admin_flags()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role (and any direct SQL) has no auth.uid() — always allowed.
  if auth.uid() is null then
    return new;
  end if;

  if new.is_super_admin is distinct from old.is_super_admin then
    raise exception 'is_super_admin can only be changed by the service role';
  end if;

  if new.is_admin is distinct from old.is_admin then
    if not public.is_super_admin(auth.uid()) then
      raise exception 'Only a super admin can change admin access';
    end if;
    if new.id = auth.uid() then
      raise exception 'You cannot change your own admin access';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists profiles_prevent_self_admin on public.profiles;
drop trigger if exists profiles_guard_admin_flags on public.profiles;
create trigger profiles_guard_admin_flags
  before update on public.profiles
  for each row execute function public.guard_admin_flags();

drop function if exists public.prevent_self_admin_promotion();

-- ---------------------------------------------------------------------------
-- 4. Grant / revoke admin.
--
-- SECURITY DEFINER so it can write a row the caller's own RLS would refuse, but
-- it takes the grantor from auth.uid() rather than an argument, so it can only
-- ever act as whoever called it. The trigger above still fires and is the real
-- enforcement — this function is the usable front door, not the lock.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_user_admin(
  target_user_id uuid,
  make_admin boolean
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid := auth.uid();
  result public.profiles;
begin
  if caller is null then
    raise exception 'Not authenticated';
  end if;
  if not public.is_super_admin(caller) then
    raise exception 'Only a super admin can change admin access';
  end if;
  if target_user_id = caller then
    raise exception 'You cannot change your own admin access';
  end if;
  -- A super admin is an admin by definition, so there is nothing here to grant
  -- and revoking would be a lie. Removing one is a service-role job.
  if public.is_super_admin(target_user_id) then
    raise exception 'That user is a super admin — their access cannot be changed here';
  end if;

  update public.profiles
     set is_admin = make_admin
   where id = target_user_id
  returning * into result;

  if not found then
    raise exception 'User not found';
  end if;
  return result;
end;
$$;

revoke all on function public.admin_set_user_admin(uuid, boolean) from public;
grant execute on function public.admin_set_user_admin(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS.
--
-- Admins can already SELECT every profile (migration 022). Nothing here widens
-- that: grants go through the RPC above, which is security definer, so no
-- update policy on profiles is needed and none is added — leaving the table
-- with no authenticated update path to anyone else's row.
-- ---------------------------------------------------------------------------
