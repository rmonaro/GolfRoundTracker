import { Geolocation, type Position, type PermissionStatus } from '@capacitor/geolocation';
import { Capacitor } from '@capacitor/core';

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
