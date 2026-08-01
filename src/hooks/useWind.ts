import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  fetchWind,
  relativeWind,
  type WindObservation,
  type RelativeWind
} from '@/services/weatherService';

export interface UseWindResult {
  wind: WindObservation | null;
  /** Head/tail/cross resolution against `targetBearingDeg`, or null if no bearing yet. */
  relative: RelativeWind | null;
  isLoading: boolean;
  error: unknown;
}

/**
 * Live wind at a coordinate, refreshed every 10 min, resolved against the
 * direction the player is hitting. Safe to call with nullish coords — it just
 * stays idle until GPS yields a fix.
 *
 * The query key snaps coords to ~1 km so ordinary GPS jitter doesn't thrash
 * fetches or invalidate the cache.
 */
export function useWind(
  lat: number | null | undefined,
  lng: number | null | undefined,
  targetBearingDeg: number | null | undefined,
  enabled = true
): UseWindResult {
  const on = enabled && lat != null && lng != null;
  const keyLat = lat != null ? Number(lat.toFixed(2)) : null;
  const keyLng = lng != null ? Number(lng.toFixed(2)) : null;

  const query = useQuery({
    queryKey: ['wind', keyLat, keyLng],
    enabled: on,
    staleTime: 10 * 60 * 1000,
    refetchInterval: 10 * 60 * 1000,
    queryFn: () => fetchWind(lat!, lng!)
  });

  // Surface fetch failures — without this a CORS/network error in the webview
  // just leaves the indicator blank with no clue why.
  useEffect(() => {
    if (query.error) console.warn('[wind] fetch failed', query.error);
  }, [query.error]);

  const wind = query.data ?? null;
  const relative =
    wind && targetBearingDeg != null ? relativeWind(wind, targetBearingDeg) : null;

  return { wind, relative, isLoading: query.isLoading, error: query.error };
}
