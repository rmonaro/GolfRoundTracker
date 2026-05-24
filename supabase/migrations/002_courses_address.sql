-- Migration 002 — add address columns to courses
-- Safe to re-run.

alter table public.courses add column if not exists address text;
alter table public.courses add column if not exists city text;
alter table public.courses add column if not exists state text;
alter table public.courses add column if not exists zip text;

-- ZIP is intentionally text, not int — US zips can have leading zeros (e.g. "02134"),
-- and international postal codes contain letters.
