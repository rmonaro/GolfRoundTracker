-- Admin course verification (migration 030).
--
-- Before this, a user-entered course was visible only to its creator
-- (RLS `courses_select`: created_by_user = auth.uid() or created_by_user is null),
-- and the "Verified" chip in the UI was cosmetic (it just meant source='api').
--
-- This adds a real `verified` flag. Flow: a user enters a course + an admin
-- pastes its Overpass JSON (existing AdminCourseDetail sync), then the admin
-- verifies it. Once verified, the course becomes visible to every user via a
-- new read policy — the same way source='api' library courses already are.
--
-- Backfill: existing source='api' courses are marked verified so the chip and
-- shared visibility keep their current meaning. Verification is stamped through
-- a SECURITY DEFINER RPC gated on is_admin() so verified_by/verified_at are
-- server-controlled and can't be spoofed by a client update.

alter table public.courses add column if not exists verified boolean not null default false;
alter table public.courses add column if not exists verified_by uuid references public.profiles(id) on delete set null;
alter table public.courses add column if not exists verified_at timestamptz;

create index if not exists courses_verified_idx on public.courses(verified);

-- Existing curated library (API imports) stays visible/verified.
update public.courses set verified = true where source = 'api' and verified = false;

do $$ begin
  -- Verified courses are readable by any signed-in user. RLS is permissive
  -- (policies OR together), so this is additive to courses_select /
  -- courses_api_read — owners still see their own unverified courses.
  drop policy if exists "courses_verified_read" on public.courses;
  create policy "courses_verified_read" on public.courses
    for select using (verified = true and auth.uid() is not null);
end $$;

-- Admin-only verify toggle. SECURITY DEFINER + is_admin() gate so verified_by /
-- verified_at are stamped server-side. Clearing verification nulls both.
create or replace function public.admin_set_course_verified(course_id uuid, make_verified boolean)
returns public.courses
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.courses;
begin
  if not public.is_admin(auth.uid()) then
    raise exception 'only admins can verify courses';
  end if;

  update public.courses
    set verified = make_verified,
        verified_by = case when make_verified then auth.uid() else null end,
        verified_at = case when make_verified then now() else null end
    where id = course_id
    returning * into updated;

  if updated.id is null then
    raise exception 'course not found';
  end if;

  return updated;
end;
$$;

grant execute on function public.admin_set_course_verified(uuid, boolean) to authenticated;
