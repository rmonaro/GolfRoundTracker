// Picks which satellite imagery the hole map should render.
//
// Four tiers, in order:
//   1. downloaded pack   → works with no signal. The whole point.
//   2. remote pack       → online, served by range from Supabase Storage.
//                          No Mapbox tile billing, and the imagery is ours.
//   3. Mapbox satellite  → online fallback for courses with no pack yet, which
//                          is also how non-US courses keep working.
//   4. (caller) SVG      → HoleLayout's last resort when nothing loads.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPackMeta, getRemotePackInfo, isPackStale } from '@/services/coursePackRepo';
import { isUsablyOnline } from '@/services/connectivity';
import { useConnectivity } from '@/features/offline/useConnectivity';
import { PROVIDER_NAME, isPmtilesProviderReady, prepareLocalPack } from './pmtilesSetup';

export type ImageryKind = 'local-pack' | 'remote-pack' | 'mapbox';

export interface ImagerySource {
  kind: ImageryKind;
  /** PMTiles URL for tiers 1-2; null for Mapbox. */
  url: string | null;
  provider: string | null;
  minZoom: number | null;
  maxZoom: number | null;
  attribution: string | null;
  /** False while we're still deciding, so the map isn't built with the wrong one. */
  ready: boolean;
}

const MAPBOX: ImagerySource = {
  kind: 'mapbox',
  url: null,
  provider: null,
  minZoom: null,
  maxZoom: null,
  attribution: null,
  ready: true
};

export function useImagerySource(courseId: string | null | undefined): ImagerySource {
  const { status } = useConnectivity();
  const [resolved, setResolved] = useState<ImagerySource | null>(null);

  // Remote availability is cached — it changes only when the tiler runs.
  const remote = useQuery({
    queryKey: ['course-pack-info', courseId],
    enabled: !!courseId && isUsablyOnline(),
    staleTime: 1000 * 60 * 60,
    queryFn: () => getRemotePackInfo(courseId as string)
  });

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!courseId) {
        if (!cancelled) setResolved(MAPBOX);
        return;
      }

      // Without a working provider, PMTiles sources can't render at all — fall
      // straight through to Mapbox rather than producing a blank map.
      if (!isPmtilesProviderReady()) {
        if (!cancelled) setResolved(MAPBOX);
        return;
      }

      // Tier 1 — a pack on the device wins, online or not: same imagery, and
      // the bandwidth is already spent.
      //
      // EXCEPT when the server has re-tiled the course since it was downloaded.
      // Then the local copy is genuinely different (older) imagery, and
      // preferring it would leave a golfer staring at a map we've already
      // replaced with no way to tell. Offline we still use it — stale imagery
      // beats none.
      const local = await getPackMeta(courseId);
      const stale = isUsablyOnline() && isPackStale(local, remote.data ?? null);
      if (local && !stale) {
        const url = await prepareLocalPack(courseId);
        if (url && !cancelled) {
          setResolved({
            kind: 'local-pack',
            url,
            provider: PROVIDER_NAME,
            minZoom: local.minZoom,
            maxZoom: local.maxZoom,
            attribution: local.attribution,
            ready: true
          });
          return;
        }
      }

      // Tiers 2-3 need the network; with none, the caller falls through to SVG.
      if (!isUsablyOnline()) {
        if (!cancelled) setResolved({ ...MAPBOX, ready: true });
        return;
      }

      const info = remote.data;
      if (info && !cancelled) {
        setResolved({
          kind: 'remote-pack',
          url: info.tilesUrl,
          provider: PROVIDER_NAME,
          minZoom: info.minZoom,
          maxZoom: info.maxZoom,
          attribution: info.attribution,
          ready: true
        });
        return;
      }

      if (!cancelled) setResolved(MAPBOX);
    })();

    return () => {
      cancelled = true;
    };
    // `status` is in here so losing or regaining signal re-evaluates the tier.
  }, [courseId, remote.data, status]);

  return resolved ?? { ...MAPBOX, ready: false };
}
