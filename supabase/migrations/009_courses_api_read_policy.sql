-- Migration 009 — let every signed-in user read api-sourced (library) courses.
-- Dialect: PostgreSQL (Supabase). Safe to re-run.

drop policy if exists "courses_api_read" on public.courses;
create policy "courses_api_read" on public.courses
  for select using (source = 'api');
