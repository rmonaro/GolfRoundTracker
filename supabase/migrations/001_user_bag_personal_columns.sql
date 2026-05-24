-- Migration 001 — add personal club attributes to user_bag
-- Run this on any Supabase project that was created from the original schema.sql
-- (i.e. before brand / model / loft existed on user_bag).
--
-- Safe to re-run: every statement is idempotent.

alter table public.user_bag add column if not exists brand text;
alter table public.user_bag add column if not exists model text;
alter table public.user_bag add column if not exists loft numeric(4,1);

-- Sanity check: should print the new columns.
-- select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'user_bag';
