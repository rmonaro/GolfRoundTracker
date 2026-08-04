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
 * and by callers that just saw a request fail unexpectedly.
 */
export async function refreshConnectivity(): Promise<ConnectivityStatus> {
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
  const status: ConnectivityStatus = reachable ? 'online' : 'degraded';
  setState({
    status,
    connectionType,
    lastOnlineAt: reachable ? Date.now() : state.lastOnlineAt
  });
  return status;
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
    if (document.visibilityState === 'visible') void refreshConnectivity();
  });
}
