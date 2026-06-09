-- Auto-detected shots (watch impact-primary tracking) are committed in an
-- "unverified" state and the golfer confirms them per-hole and/or at the end
-- of the round. Existing + manually-entered shots default to verified = true,
-- so historical data and the manual flow are unaffected.
alter table public.shots
  add column if not exists verified boolean not null default true;
