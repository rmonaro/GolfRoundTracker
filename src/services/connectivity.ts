// Connectivity state — the single source of truth for "can we reach the server".
//
// Deliberately NOT a React hook at its core: repos and services need to branch
// on connectivity too (cache-first reads, queueing writes), and they run outside
// the component tree. This is a plain observable module with a `useConnectivity`
// hook layered on top via useSyncExternalStore.
//
// Three states, not two. A golf course rarely gives you a clean binary — the
// common failure is one bar of LTE where requests hang for 30s and then fail,
// which is worse for the user than being cleanly offline (offline fails fast and
// we fall back immediately). `degraded` exists so callers can treat "technically
// connected but useless" the same as offline for fallback purposes, while still
// letting a background sync try its luck.
//
//   online    — reachable, responsive
//   degraded  — the platform says connected, but a probe was slow or failed
//   offline   — the platform says disconnected (or dev override)

import { Network } from '@capacitor/network';

export type ConnectivityStatus = 'online' | 'offline' | 'degraded';

/** Anything slower than this to first byte means "don't bother" on a course. */
const PROBE_TIMEOUT_MS = 4000;
/** Dev-only override, persisted so it survives a reload while testing. */
const SIMULATE_KEY = 'grt-simulate-offline';

/**
 * Deadline for an ordinary API request (see `lib/supabase.ts`).
 *
 * The reason this exists at all: `fetch` has NO timeout, and one bar of LTE is
 * a connection that accepts the SYN and then stalls. Without a deadline the
 * hole screen sits on a spinner for as long as the OS keeps the socket alive —
 * minutes — even though a complete copy of the course is already on the device.
 * A request nobody is waiting for is better dead.
 */
export const REQUEST_TIMEOUT_MS = 8000;

/**
 * Edge functions and storage do real work (OSM sync, multi-MB packs) and are
 * legitimately slow, so they get their own, much longer deadline. They still
 * get one: a hung upload should end, eventually.
 */
export const SLOW_REQUEST_TIMEOUT_MS = 60_000;

/**
 * Foreground heartbeat. Platform events cover the interface going up and down,
 * but signal FADING fires nothing at all — the radio stays "connected" while
 * throughput goes to zero. Without a poll, a golfer walking from the car park
 * into the trees keeps a stale `online` for the rest of the round.
 */
const HEARTBEAT_ONLINE_MS = 45_000;
/** Poll harder once we think we're degraded so recovery is noticed quickly. */
const HEARTBEAT_UNHEALTHY_MS = 15_000;

/**
 * After a real request times out, ignore probe SUCCESSES for this long.
 *
 * The probe is a single tiny no-cors GET; on a weak link it can sail through
 * while a real PostgREST query stalls. Without this, connectivity would flap
 * online→degraded→online every few seconds, rebuilding the map each time and
 * sending repos back to the network that just failed them. A genuine request
 * success still clears it immediately — that's stronger evidence than a probe.
 */
const DEGRADED_COOLDOWN_MS = 30_000;

interface ConnectivityState {
  status: ConnectivityStatus;
  /** 'wifi' | 'cellular' | 'none' | 'unknown' — from the platform. */
  connectionType: string;
  /** Last time a probe actually confirmed reachability. */
  lastOnlineAt: number | null;
}

let state: ConnectivityState = {
  status: 'online',
  connectionType: 'unknown',
  lastOnlineAt: null
};

const listeners = new Set<() => void>();

/** While `Date.now()` is below this, a passing probe cannot promote to online. */
let degradedUntil = 0;
/** De-dupes overlapping refreshes (heartbeat + event + a failed request). */
let inflightRefresh: Promise<ConnectivityStatus> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;

function emit() {
  for (const l of listeners) l();
}

function setState(patch: Partial<ConnectivityState>) {
  const next = { ...state, ...patch };
  // Reference equality matters — useSyncExternalStore re-renders on identity
  // change, so bail when nothing actually moved.
  if (
    next.status === state.status &&
    next.connectionType === state.connectionType &&
    next.lastOnlineAt === state.lastOnlineAt
  ) {
    return;
  }
  state = next;
  emit();
}

// --- dev override ----------------------------------------------------------

function simulatedOffline(): boolean {
  try {
    return localStorage.getItem(SIMULATE_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Force offline for testing.
 *
 * NOT dev-build-only: the whole point is testing a real round on a real device,
 * and Capacitor serves the production bundle, so a DEV-gated flag would be
 * compiled out exactly where it's needed. Access is gated at the UI instead
 * (dev builds, or an admin account) — see SettingsPage.
 *
 * Because this persists, an admin who forgets it is on would see a permanently
 * "offline" app. The Settings card shows a warning while it's active, and
 * `clearSimulatedOffline()` exists as a recovery hatch.
 */
export function setSimulatedOffline(on: boolean) {
  try {
    if (on) localStorage.setItem(SIMULATE_KEY, '1');
    else localStorage.removeItem(SIMULATE_KEY);
  } catch {
    /* private mode — ignore */
  }
  void refreshConnectivity();
}

/** Unconditional escape hatch, callable from the console: `__grtClearOffline()`. */
export function clearSimulatedOffline() {
  setSimulatedOffline(false);
}

export function isSimulatedOffline(): boolean {
  return simulatedOffline();
}

// --- reads -----------------------------------------------------------------

export function getConnectivity(): ConnectivityState {
  return state;
}

/** Convenience: treat `degraded` as unusable for read/fallback decisions. */
export function isUsablyOnline(): boolean {
  return state.status === 'online';
}

export function subscribeConnectivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// --- probing ---------------------------------------------------------------

/**
 * Confirm we can actually reach Supabase. The platform's "connected" flag only
 * proves a network interface is up — it says nothing about whether packets get
 * anywhere, which is exactly the failure mode on a course (and behind captive
 * portals).
 *
 * Uses the Supabase URL rather than a generic endpoint: reaching google.com
 * while our own backend is unreachable is still unusable for us.
 */
async function probe(): Promise<boolean> {
  const url = import.meta.env.VITE_SUPABASE_URL;
  if (!url) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // `no-cors` keeps this cheap and avoids CORS preflight; we only care that
    // the request completed at all, not what it returned.
    await fetch(`${url}/auth/v1/health`, {
      method: 'GET',
      mode: 'no-cors',
      cache: 'no-store',
      signal: controller.signal
    });
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Re-evaluate connectivity now. Called on platform change events, on app resume,
 * on the foreground heartbeat, and by callers that just saw a request fail.
 *
 * Concurrent calls share one probe — the heartbeat, a network event and a failed
 * request routinely land together, and three probes down a link that's already
 * struggling is exactly the wrong thing to do.
 */
export function refreshConnectivity(): Promise<ConnectivityStatus> {
  if (!inflightRefresh) {
    inflightRefresh = runRefresh().finally(() => {
      inflightRefresh = null;
    });
  }
  return inflightRefresh;
}

async function runRefresh(): Promise<ConnectivityStatus> {
  if (simulatedOffline()) {
    setState({ status: 'offline', connectionType: 'none' });
    return 'offline';
  }

  let connected = true;
  let connectionType = 'unknown';
  try {
    const s = await Network.getStatus();
    connected = s.connected;
    connectionType = s.connectionType;
  } catch {
    // Web without the plugin — fall back to the browser's own signal.
    connected = navigator.onLine;
  }

  if (!connected) {
    setState({ status: 'offline', connectionType });
    return 'offline';
  }

  const reachable = await probe();
  // A probe that passes during the cooldown doesn't get to overrule a real
  // request that just timed out — see DEGRADED_COOLDOWN_MS.
  const healthy = reachable && Date.now() >= degradedUntil;
  const status: ConnectivityStatus = healthy ? 'online' : 'degraded';
  setState({
    status,
    connectionType,
    lastOnlineAt: reachable ? Date.now() : state.lastOnlineAt
  });
  return status;
}

// --- traffic-driven signal -------------------------------------------------
//
// Probing on a timer can only ever be a coarse sample. The app's OWN requests
// are the best connectivity sensor it has: they run constantly, they use the
// same host and the same transport, and when one of them stalls the user is
// already waiting. `lib/supabase.ts` reports every request through here.

/**
 * A request completed (any HTTP status — a 404 still proves the packets flow).
 * Cheap and called often, so it must stay allocation-free on the hot path.
 */
export function reportRequestSuccess(): void {
  if (simulatedOffline()) return;
  degradedUntil = 0;
  const now = Date.now();
  // Only churn state when something actually changed. `lastOnlineAt` is
  // deliberately throttled: every request updating it would re-render every
  // `useConnectivity` consumer on the page.
  if (state.status === 'online' && now - (state.lastOnlineAt ?? 0) < 10_000) return;
  setState({ status: 'online', lastOnlineAt: now });
}

/**
 * A request died at the transport layer — timed out, or `fetch` rejected.
 *
 * Demote IMMEDIATELY rather than waiting for the probe to come back: the point
 * is that the next repo call reads its cache instead of queueing behind another
 * stalled socket. The probe still runs, to sort "gone" from "slow" and to find
 * the way back.
 */
export function reportRequestFailure(reason: 'timeout' | 'network'): void {
  if (simulatedOffline()) return;
  if (reason === 'timeout') degradedUntil = Date.now() + DEGRADED_COOLDOWN_MS;
  if (state.status === 'online') setState({ status: 'degraded' });
  void refreshConnectivity();
}

// --- heartbeat -------------------------------------------------------------

function heartbeatDelay(): number {
  return state.status === 'online' ? HEARTBEAT_ONLINE_MS : HEARTBEAT_UNHEALTHY_MS;
}

function stopHeartbeat() {
  if (heartbeatTimer) clearTimeout(heartbeatTimer);
  heartbeatTimer = null;
}

/**
 * Self-rescheduling poll (not setInterval — the cadence depends on the status
 * the previous tick produced). Runs only while the app is visible; a phone in a
 * pocket mid-round shouldn't be waking the radio, and `visibilitychange`
 * already forces a fresh check the moment it comes back out.
 */
function startHeartbeat() {
  stopHeartbeat();
  if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
  heartbeatTimer = setTimeout(() => {
    // Recent real traffic is proof enough — skip the probe and save the round
    // trip. Only an idle app actually needs the heartbeat.
    const quiet = Date.now() - (state.lastOnlineAt ?? 0) >= HEARTBEAT_ONLINE_MS;
    const skip = state.status === 'online' && !quiet;
    const check = skip ? Promise.resolve(state.status) : refreshConnectivity();
    void check.finally(startHeartbeat);
  }, heartbeatDelay());
}

let initialized = false;

/**
 * Bind platform listeners once at bootstrap. Idempotent.
 *
 * We re-probe on every platform transition rather than trusting `connected`,
 * because the transition to "connected" fires the moment an interface comes up
 * — typically well before it can actually carry a request.
 */
export function initConnectivity() {
  if (initialized) return;
  initialized = true;

  // Console recovery hatch — if the simulate-offline flag is ever left on and
  // the Settings toggle isn't reachable, this always is.
  (window as unknown as Record<string, unknown>).__grtClearOffline = clearSimulatedOffline;

  void refreshConnectivity();

  void Network.addListener('networkStatusChange', () => {
    void refreshConnectivity();
  }).catch(() => {
    // Plugin unavailable (plain web) — use the DOM events instead.
    window.addEventListener('online', () => void refreshConnectivity());
    window.addEventListener('offline', () => void refreshConnectivity());
  });

  // Coming back from background is the single most likely moment for
  // connectivity to have changed without an event firing.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void refreshConnectivity();
      startHeartbeat();
    } else {
      stopHeartbeat();
    }
  });

  startHeartbeat();
}
