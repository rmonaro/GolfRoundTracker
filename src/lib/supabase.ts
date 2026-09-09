import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import {
  REQUEST_TIMEOUT_MS,
  SLOW_REQUEST_TIMEOUT_MS,
  WRITE_REQUEST_TIMEOUT_MS,
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
 * they get the long deadline. PostgREST writes get a middle one — see
 * WRITE_REQUEST_TIMEOUT_MS; aborting a write is ambiguous in a way aborting a
 * read is not. Everything else — reads, auth — is a small round trip that has
 * no business taking more than a few seconds.
 */
function deadlineFor(target: string, method: string): number {
  if (target.includes('/functions/v1/') || target.includes('/storage/v1/')) {
    return SLOW_REQUEST_TIMEOUT_MS;
  }
  if (target.includes('/rest/v1/') && !isRead(method)) return WRITE_REQUEST_TIMEOUT_MS;
  return REQUEST_TIMEOUT_MS;
}

function isRead(method: string): boolean {
  const m = method.toUpperCase();
  return m === 'GET' || m === 'HEAD';
}

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

/**
 * Anything at or past this is worth a line in the console even when it
 * succeeds. Well under the 8s read deadline, so a request drifting towards a
 * timeout is visible BEFORE it becomes one.
 */
const SLOW_REQUEST_LOG_MS = 3000;

/** Path + query only. Keeps the log readable and the token out of it. */
function pathOf(target: string): string {
  try {
    const u = new URL(target);
    return u.pathname + u.search;
  } catch {
    return target;
  }
}

function methodOf(input: RequestInfo | URL, init?: RequestInit): string {
  if (init?.method) return init.method;
  if (typeof input !== 'string' && !(input instanceof URL)) return input.method;
  return 'GET';
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
  const target = urlOf(input);
  const method = methodOf(input, init);
  const startedAt = Date.now();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deadlineFor(target, method));

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
    // A request that took seconds but DID land is the interesting middle case:
    // it says the deadline is being approached rather than blown, and it names
    // which call is slow. Without this the only signal was the failure, which
    // arrives with no context at all about what was being asked for.
    const elapsed = Date.now() - startedAt;
    if (elapsed >= SLOW_REQUEST_LOG_MS) {
      console.warn(`[supabase] slow ${method} ${pathOf(target)} — ${elapsed}ms, status ${res.status}`);
    }
    return res;
  } catch (err) {
    // A caller-driven cancel says nothing about the network — don't let an
    // unmounted screen demote connectivity for everyone else.
    if (callerSignal?.aborted) throw err;
    if (timedOut) {
      console.warn(
        `[supabase] TIMEOUT ${method} ${pathOf(target)} after ${Date.now() - startedAt}ms ` +
          `(deadline ${deadlineFor(target, method)}ms) — the request never came back`
      );
      reportRequestFailure('timeout');
      // Say the true thing for each case. A read that gives up falls back to
      // the cache, which is fine and worth saying. A write that gives up
      // leaves the user not knowing whether it took — the abort kills the
      // socket, not the statement the server is already running.
      throw new Error(
        isRead(method)
          ? 'The network is too slow to reach the server right now — using offline data.'
          : 'The server took too long to respond. Your change may not have been saved — check and try again.'
      );
    }
    console.warn(
      `[supabase] FAILED ${method} ${pathOf(target)} after ${Date.now() - startedAt}ms`,
      err
    );
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
