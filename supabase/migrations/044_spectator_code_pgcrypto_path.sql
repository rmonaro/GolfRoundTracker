-- Migration 044 — Fix "function gen_random_bytes(integer) does not exist"
-- Dialect: PostgreSQL (Supabase). T-SQL linter false-positives expected.
-- Safe to re-run.
--
-- Minting a spectator code failed with:
--   function gen_random_bytes(integer) does not exist
--
-- WHY, and it is not that the extension is missing. Migration 041 ran
-- `create extension if not exists pgcrypto`, and on Supabase that lands in the
-- **extensions** schema, not `public`. A normal session finds it because
-- Supabase puts `extensions` on the default search_path — but
-- `create_spectator_share` is declared `security definer` with
-- `set search_path = public`, and that setting is in force for the whole call
-- INCLUDING the nested `generate_spectator_code()` (which sets no path of its
-- own and therefore inherits its caller's). Inside that call `extensions` is
-- not on the path, so an unqualified `gen_random_bytes` resolves to nothing.
--
-- Which is why this never showed up in testing against a stack where pgcrypto
-- happened to be in `public`: the same SQL works or doesn't depending on where
-- the extension was installed.
--
-- FIX: pin `public, extensions` on both functions rather than hard-qualifying
-- `extensions.gen_random_bytes`. Schema-qualifying would break the other way on
-- an install that has pgcrypto in `public`; naming both schemas resolves it
-- wherever it actually lives.

-- Idempotent, and a no-op when pgcrypto is already installed anywhere — the
-- `with schema` clause is ignored rather than an error in that case.
create extension if not exists pgcrypto with schema extensions;

-- Unchanged except for the search_path line. Body kept verbatim from 041 so the
-- two can be diffed.
create or replace function public.generate_spectator_code()
returns text
language plpgsql
volatile
set search_path = public, extensions
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

-- The caller's own path also widened: a `security definer` function's
-- search_path applies to everything it calls, so leaving this one at `public`
-- would keep breaking any future pgcrypto use inside it.
alter function public.create_spectator_share(text, timestamptz)
  set search_path = public, extensions;

-- Verify — this is the one that exercises pgcrypto, and it needs no session:
--   select public.generate_spectator_code();          -- 8 chars, no dash
--
-- Do NOT verify with `select * from public.create_spectator_share(null, null)`
-- in the SQL editor. That runs as `postgres` with no JWT, so `auth.uid()` is
-- null and the function raises 'Not authenticated' at its guard — BEFORE it
-- ever reaches the code generator, so it proves nothing about this fix. To
-- exercise the whole path, borrow an athlete's identity for one transaction:
--
--   begin;
--   select set_config(
--     'request.jwt.claims',
--     json_build_object('sub', '<athlete-user-uuid>')::text,
--     true                                    -- transaction-local
--   );
--   select * from public.create_spectator_share('SQL editor test', null);
--   rollback;                                 -- commit instead to keep the code
