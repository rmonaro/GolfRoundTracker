import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  REQUEST_TIMEOUT_MS,
  SLOW_REQUEST_TIMEOUT_MS,
  reportRequestFailure,
  reportRequestSuccess
} from '@/services/connectivity';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !anon) {
  console.warn(
    '[supabase] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY — copy .env.example to .env.local'
  );
}

/**
 * Edge functions (OSM sync) and storage transfers are legitimately slow, so
 * they get the long deadline. Everything else — PostgREST reads, auth — is a
 * small round trip that has no business taking more than a few seconds.
 */
function deadlineFor(target: string): number {
  return target.includes('/functions/v1/') || target.includes('/storage/v1/')
    ? SLOW_REQUEST_TIMEOUT_MS
    : REQUEST_TIMEOUT_MS;
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Every Supabase request runs against a deadline, and reports its outcome to
 * the connectivity module.
 *
 * WHY: `fetch` never times out on its own. The characteristic golf-course
 * failure isn't a clean disconnect — it's one bar, where the socket opens and
 * then nothing comes back. Left alone, a hole-layout query hangs for as long as
 * the OS keeps the connection alive while the screen shows a spinner over a
 * course whose geometry and imagery are already sitting in IndexedDB. The user
 * had to toggle "simulate offline" by hand to get the map they'd downloaded.
 *
 * The reporting half matters as much as the timeout: real requests are a far
 * better connectivity sensor than a periodic probe, so the first stalled query
 * flips the app to `degraded` and every repo behind it goes cache-first.
 */
async function fetchWithDeadline(
  input: RequestInfo | URL,
  init?: RequestInit
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadlineFor(urlOf(input)));

  // Honour a caller's own signal (supabase-js passes one for auth refresh, and
  // React Query cancels queries on unmount) — chained, not replaced.
  const callerSignal = init?.signal ?? null;
  const onCallerAbort = () => controller.abort();
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort();
    else callerSignal.addEventListener('abort', onCallerAbort);
  }

  try {
    const res = await fetch(input, { ...init, signal: controller.signal });
    reportRequestSuccess();
    return res;
  } catch (err) {
    // A caller-driven cancel says nothing about the network — don't let an
    // unmounted screen demote connectivity for everyone else.
    if (callerSignal?.aborted) throw err;
    if (timedOut) {
      reportRequestFailure('timeout');
      throw new Error(
        'The network is too slow to reach the server right now — using offline data.'
      );
    }
    reportRequestFailure('network');
    throw err;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', onCallerAbort);
  }
}

// Note: we intentionally don't pass the Database generic here. The Postgrest
// type inference is strict in supabase-js v2, and our repository layer in
// src/services/* is the source of truth for entity shapes.
export const supabase: SupabaseClient = createClient(
  url ?? 'http://localhost:54321',
  anon ?? 'public-anon-key',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: typeof window === 'undefined' ? undefined : window.localStorage
    },
    global: { fetch: fetchWithDeadline }
  }
);
