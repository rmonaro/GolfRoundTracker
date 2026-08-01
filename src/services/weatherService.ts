import { toAppError } from './errors';

/**
 * Live wind for the golfer's current spot. Sourced from Open-Meteo — free, no
 * API key, CORS-enabled — so we call it straight from the client (no edge
 * function needed). Keys would be the only reason to proxy it server-side.
 *
 * The raw observation is absolute (a compass direction the wind blows FROM).
 * `relativeWind()` resolves that against the direction the player is hitting
 * into the head/tail/cross terms that actually drive club selection.
 */

export interface WindObservation {
  /** Sustained wind speed at 10 m, mph. */
  speedMph: number;
  /** Gust speed at 10 m, mph (null if the provider omits it). */
  gustMph: number | null;
  /** Direction the wind blows FROM, degrees clockwise from north (meteorological convention). */
  fromDeg: number;
  /** Observation time per the provider (epoch ms). */
  observedAt: number;
}

const OPEN_METEO_URL = 'https://api.open-meteo.com/v1/forecast';

interface OpenMeteoResponse {
  current?: {
    time?: string;
    wind_speed_10m?: number;
    wind_direction_10m?: number;
    wind_gusts_10m?: number;
  };
}

// Wind barely shifts minute to minute, and the GPS dot nudges constantly — so
// cache by a ~1 km grid cell for a few minutes rather than refetching on every
// fix. react-query layers its own caching on top; this guards the raw service
// for any non-hook caller too.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; value: WindObservation }>();

function gridKey(lat: number, lng: number): string {
  return `${lat.toFixed(2)},${lng.toFixed(2)}`;
}

/** Fetch the current wind at a coordinate. Throws an AppError on network/shape failure. */
export async function fetchWind(lat: number, lng: number): Promise<WindObservation> {
  const key = gridKey(lat, lng);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;

  const url =
    `${OPEN_METEO_URL}?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    '&current=wind_speed_10m,wind_direction_10m,wind_gusts_10m&wind_speed_unit=mph';

  let json: OpenMeteoResponse;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`weather request failed (${res.status})`);
    json = (await res.json()) as OpenMeteoResponse;
  } catch (err) {
    throw toAppError(err, 'Could not load wind');
  }

  const c = json.current;
  if (!c || c.wind_speed_10m == null || c.wind_direction_10m == null) {
    throw toAppError({ message: 'wind missing from response' }, 'Wind data unavailable here');
  }

  const value: WindObservation = {
    speedMph: c.wind_speed_10m,
    gustMph: c.wind_gusts_10m ?? null,
    fromDeg: c.wind_direction_10m,
    observedAt: c.time ? Date.parse(c.time) : Date.now()
  };
  cache.set(key, { at: Date.now(), value });
  return value;
}

export type WindBucket = 'calm' | 'helping' | 'hurting' | 'crossL2R' | 'crossR2L';

export interface RelativeWind {
  /** Along-shot component: + = tailwind (helping), − = headwind (hurting), mph. */
  alongMph: number;
  /** Cross component: + = pushes left→right across your aim, − = right→left, mph. */
  crossMph: number;
  bucket: WindBucket;
  /** Short UI label, e.g. "Hurting", "L→R". */
  label: string;
  /**
   * Rotation (deg CW) for an up-pointing arrow when "up" = your target line:
   * 0 = wind at your back (helping), 180 = in your face (hurting),
   * 90 = pushing left→right.
   */
  arrowDeg: number;
}

// Below this, direction is noise — just call it calm.
const CALM_MPH = 2;

/**
 * Resolve an absolute wind observation against the direction you're hitting
 * (`targetBearingDeg`, compass degrees CW from north) into head/tail/cross
 * terms. Pure function — no network, trivially testable.
 */
export function relativeWind(wind: WindObservation, targetBearingDeg: number): RelativeWind {
  // Wind blows TO the reciprocal of where it comes FROM.
  const toDeg = (wind.fromDeg + 180) % 360;
  const delta = toDeg - targetBearingDeg;
  const deltaRad = (delta * Math.PI) / 180;
  const alongMph = wind.speedMph * Math.cos(deltaRad); // + toward target ⇒ tailwind
  const crossMph = wind.speedMph * Math.sin(deltaRad); // + ⇒ right of your aim
  const arrowDeg = ((delta % 360) + 360) % 360;

  let bucket: WindBucket;
  let label: string;
  if (wind.speedMph < CALM_MPH) {
    bucket = 'calm';
    label = 'Calm';
  } else if (Math.abs(alongMph) >= Math.abs(crossMph)) {
    bucket = alongMph >= 0 ? 'helping' : 'hurting';
    label = alongMph >= 0 ? 'Helping' : 'Hurting';
  } else {
    bucket = crossMph >= 0 ? 'crossL2R' : 'crossR2L';
    label = crossMph >= 0 ? 'L→R' : 'R→L';
  }
  return { alongMph, crossMph, bucket, label, arrowDeg };
}

const COMPASS_16 = [
  'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
  'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'
];

/** Nearest 16-point compass label for a bearing (deg CW from north). */
export function compassLabel(deg: number): string {
  return COMPASS_16[Math.round((((deg % 360) + 360) % 360) / 22.5) % 16];
}

/** Compass bearing (deg CW from north) from point A to point B. Equirectangular approx — fine at golf-hole scale. */
export function bearingDeg(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = (bLng - aLng) * Math.cos(toRad((aLat + bLat) / 2));
  const dLat = bLat - aLat;
  return ((Math.atan2(dLng, dLat) * 180) / Math.PI + 360) % 360;
}
