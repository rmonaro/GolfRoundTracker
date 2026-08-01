import { Geolocation, type Position, type PermissionStatus } from '@capacitor/geolocation';
import { Capacitor, registerPlugin } from '@capacitor/core';

// --- background geolocation (native) ---------------------------------------
// @capacitor-community/background-geolocation keeps delivering fixes while the
// app is backgrounded / the phone is locked (the official @capacitor/geolocation
// plugin does not). We register it lazily and fall back to the foreground watch
// if it isn't available (e.g. web, or before `npx cap sync`).

interface BgLocation {
  latitude: number;
  longitude: number;
  accuracy: number;
  /** Epoch ms, or null if unknown. */
  time: number | null;
}

interface BgWatcherError {
  code?: string;
  message?: string;
}

interface BackgroundGeolocationPlugin {
  addWatcher(
    options: {
      backgroundMessage?: string;
      backgroundTitle?: string;
      requestPermissions?: boolean;
      stale?: boolean;
      distanceFilter?: number;
    },
    callback: (position?: BgLocation, error?: BgWatcherError) => void
  ): Promise<string>;
  removeWatcher(options: { id: string }): Promise<void>;
  openSettings(): Promise<void>;
}

const BackgroundGeolocation = registerPlugin<BackgroundGeolocationPlugin>('BackgroundGeolocation');

/**
 * Thin wrapper around Capacitor Geolocation. Same API works on web (the
 * plugin falls back to browser `navigator.geolocation`), iOS, and Android.
 *
 * Conventions:
 *   • All coords use [lng, lat] (GeoJSON order) when shaped for downstream
 *     consumers; the underlying plugin yields {latitude, longitude} which we
 *     normalize per call.
 *   • All distances in meters.
 *   • Errors throw — callers handle them per UX (toast / inline alert).
 */

export interface GpsPoint {
  lat: number;
  lng: number;
  /** Accuracy radius in meters (lower = better). Filter unreliable fixes via this. */
  accuracyM: number;
  /** Capture timestamp in ms (epoch). */
  timestamp: number;
}

const DEFAULT_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  // 15s feels right for course conditions — first fix on a cold start can be
  // slow under tree cover. Shorter than the 60s a satellite cold-fix can need
  // but long enough that users don't think the app is hung.
  timeout: 15_000,
  // Maximum acceptable cached age. Course-side a 10s-old fix is fine —
  // GPS units don't move fast enough to matter at typical walking pace.
  maximumAge: 10_000
};

/**
 * Returns true if geolocation is usable here. Always true on native; on web
 * we check the navigator API since some browsers / contexts (insecure http,
 * privacy-hardened ones) won't expose it.
 */
export function isGpsAvailable(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  return typeof navigator !== 'undefined' && 'geolocation' in navigator;
}

/**
 * Check + request location permission. Browsers grant implicitly on first
 * getCurrentPosition call (prompts the user). On iOS/Android the plugin
 * surfaces the permission state explicitly.
 */
export async function ensureGpsPermission(): Promise<PermissionStatus> {
  const status = await Geolocation.checkPermissions();
  if (status.location === 'granted' || status.coarseLocation === 'granted') {
    return status;
  }
  // requestPermissions triggers the native prompt. On web this is a no-op
  // because the prompt is tied to the first getCurrentPosition call.
  return Geolocation.requestPermissions({ permissions: ['location'] });
}

function normalize(pos: Position): GpsPoint {
  return {
    lat: pos.coords.latitude,
    lng: pos.coords.longitude,
    accuracyM: pos.coords.accuracy,
    timestamp: pos.timestamp
  };
}

/** One-shot location. Falls back to anything > a 60s cache to be polite. */
export async function getCurrentPosition(
  options?: Partial<PositionOptions>
): Promise<GpsPoint> {
  const pos = await Geolocation.getCurrentPosition({ ...DEFAULT_OPTIONS, ...options });
  return normalize(pos);
}

export interface WatchOptions {
  enableHighAccuracy?: boolean;
  /** Drop fixes worse than this accuracy radius (meters). Default 25. */
  maxAccuracyM?: number;
  /** Minimum time between forwarded fixes (ms). De-bounces rapid-fire providers. Default 800. */
  minIntervalMs?: number;
  /**
   * If the underlying watch goes silent (no fix OR error callback) for this
   * long, transparently tear it down and restart it. Keeps the "you are here"
   * dot alive when the OS suspends the watch on backgrounding, a provider
   * stalls, or the handle dies — so the user never has to toggle tracking
   * off/on. Default 20s.
   */
  staleRestartMs?: number;
}

/**
 * Continuous-watch wrapper. Forwards each accepted fix to `onFix`. Returns
 * an unsubscribe function safe to call before the watch even starts.
 *
 * On native it uses background geolocation, so the live position keeps updating
 * (and auto-track keeps detecting shots) while the phone is locked / pocketed.
 * On web it uses the official watch with a self-healing watchdog. Either way:
 *   • Drop fixes with accuracy radius > `maxAccuracyM`.
 *   • Coalesce bursts to 1 fix per `minIntervalMs`.
 */
export function watchPosition(
  onFix: (point: GpsPoint) => void,
  options?: WatchOptions
): () => void {
  const maxAccuracy = options?.maxAccuracyM ?? 25;
  const minInterval = options?.minIntervalMs ?? 800;
  let lastEmittedMs = 0;

  // Shared gate: accuracy + de-bounce, applied to every accepted fix.
  const forward = (fix: GpsPoint) => {
    if (fix.accuracyM > maxAccuracy) return;
    const now = Date.now();
    if (now - lastEmittedMs < minInterval) return;
    lastEmittedMs = now;
    onFix(fix);
  };

  if (Capacitor.isNativePlatform()) {
    return watchBackgroundNative(forward, options);
  }
  return watchForeground(forward, options);
}

/**
 * Native background watch. Survives backgrounding / a locked screen via
 * `UIBackgroundModes: location` + the Always permission (requested here). Falls
 * back to the foreground watch if the plugin isn't present (e.g. not synced).
 */
function watchBackgroundNative(
  forward: (fix: GpsPoint) => void,
  options?: WatchOptions
): () => void {
  let watcherId: string | null = null;
  let cancelled = false;
  let fellBack: (() => void) | null = null;

  BackgroundGeolocation.addWatcher(
    {
      // A non-empty backgroundMessage is what enables background updates +
      // triggers the Always-permission request on iOS.
      backgroundMessage: 'Tracking your round so shot distances stay accurate.',
      backgroundTitle: 'Round in progress',
      requestPermissions: true,
      // Deliver fresh fixes only (no stale cached location on start).
      stale: false,
      distanceFilter: 0
    },
    (position, error) => {
      if (cancelled) return;
      if (error || !position) return;
      forward({
        lat: position.latitude,
        lng: position.longitude,
        accuracyM: position.accuracy,
        timestamp: position.time ?? Date.now()
      });
    }
  )
    .then((id) => {
      if (cancelled) {
        BackgroundGeolocation.removeWatcher({ id }).catch(() => undefined);
        return;
      }
      watcherId = id;
    })
    .catch((err) => {
      // Plugin missing / failed to start — degrade to the foreground watch so
      // the dot still works (just not while backgrounded).
      console.warn('[gps] background watcher unavailable, using foreground', err);
      if (!cancelled) fellBack = watchForeground(forward, options);
    });

  return () => {
    cancelled = true;
    if (watcherId) BackgroundGeolocation.removeWatcher({ id: watcherId }).catch(() => undefined);
    if (fellBack) fellBack();
  };
}

/**
 * Foreground watch (web + native fallback). Self-healing: a watchdog restarts
 * the underlying Geolocation watch if it stops calling back (provider stall,
 * dead handle) so the live position doesn't silently freeze.
 */
function watchForeground(
  forward: (fix: GpsPoint) => void,
  options?: WatchOptions
): () => void {
  let watchId: string | null = null;
  let cancelled = false;
  let restarting = false;
  // Last time the OS called back AT ALL (fix or error) — a liveness signal.
  let lastCallbackMs = Date.now();
  const staleMs = options?.staleRestartMs ?? 20_000;

  const clearCurrent = async () => {
    const id = watchId;
    watchId = null;
    if (id) await Geolocation.clearWatch({ id }).catch(() => undefined);
  };

  const start = () => {
    if (cancelled) return;
    lastCallbackMs = Date.now();
    Geolocation.watchPosition(
      {
        enableHighAccuracy: options?.enableHighAccuracy ?? true,
        timeout: 15_000,
        maximumAge: 0
      },
      (pos, err) => {
        if (cancelled) return;
        // Any callback — even an error — means the watch is alive; reset the
        // watchdog so a burst of transient errors doesn't thrash restarts.
        lastCallbackMs = Date.now();
        if (err || !pos) return;
        forward(normalize(pos));
      }
    )
      .then((id) => {
        if (cancelled) {
          Geolocation.clearWatch({ id }).catch(() => undefined);
          return;
        }
        watchId = id;
      })
      .catch(() => undefined);
  };

  const restart = async () => {
    if (cancelled || restarting) return;
    restarting = true;
    await clearCurrent();
    start();
    restarting = false;
  };

  start();

  const watchdog = setInterval(() => {
    if (cancelled || restarting) return;
    if (Date.now() - lastCallbackMs > staleMs) {
      lastCallbackMs = Date.now(); // avoid a tight loop while it re-locks
      void restart();
    }
  }, 5_000);

  return () => {
    cancelled = true;
    clearInterval(watchdog);
    void clearCurrent();
  };
}

/**
 * Haversine distance in meters between two GPS points. Mirrors the shared
 * helper in the edge function so client + server numbers match.
 */
export function haversineMeters(a: GpsPoint, b: GpsPoint): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Convert meters → yards (golf-display unit). 1 yd = 0.9144 m. */
export function metersToYards(m: number): number {
  return m / 0.9144;
}
