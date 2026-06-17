-- Tag swing sessions by their origin so a watch practice session started from
-- the GPS Range mode doesn't surface as a separate "Swing/Net" entry in the
-- practice history. Existing rows backfill to 'practice'.
alter table public.swing_sessions
  add column if not exists source text not null default 'practice';
