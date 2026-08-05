// Picks which satellite imagery the hole map should render.
//
// Four tiers, in order:
//   1. Mapbox satellite  → whenever the connection is actually usable.
//   2. downloaded pack   → no signal. The whole point.
//   3. remote pack       → degraded signal: one ranged read beats Mapbox's
//                          tile fan-out, and often lands where Mapbox stalls.
//   4. (caller) SVG      → HoleLayout's last resort when nothing loads.
//
// MAPBOX GOES FIRST, and that's a reversal — packs used to win "online or not".
// The reason is resolution: a pack stops at z19 (~0.22 m/px) while the map
// zooms to z21, and to z23 in putting mode. Past the pack's max zoom Mapbox
// stretches those tiles 4-16x, which reads as a blurry map rather than a
// zoomed one. Mapbox serves real tiles the whole way down. So a pack is
// INSURANCE against losing signal, not a replacement for the online map —
// and downloading one must never make the map look worse on wifi.

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPackMeta, getRemotePackInfo } from '@/services/coursePackRepo';
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

      // Tier 1 — a usable connection means Mapbox, always. See the header:
      // deeper zooms and fresher imagery than anything we tile ourselves.
      if (isUsablyOnline()) {
        if (!cancelled) setResolved(MAPBOX);
        return;
      }

      // Past here the connection is degraded or gone, so a pack is the best
      // thing available. Staleness deliberately does NOT disqualify it — old
      // imagery beats no imagery, and there's no way to fetch newer anyway.
      // `CoursePackButton` is where a stale pack gets flagged for re-download.
      const local = await getPackMeta(courseId);
      if (local) {
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

      // Tier 3 — degraded only. `remote.data` may be a cached value from when
      // the signal was good, so gate on the live status rather than its
      // presence: fully offline, the ranged fetch can only hang and fail.
      const info = remote.data;
      if (info && status === 'degraded' && !cancelled) {
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

      // Nothing usable — resolve to Mapbox so the caller can make the SVG call.
      if (!cancelled) setResolved({ ...MAPBOX, ready: true });
    })().catch((err) => {
      // This MUST resolve to something. `HoleLayout` holds a placeholder while
      // `ready` is false to avoid flashing the SVG before a downloaded map
      // appears — so an unresolved tier would spin forever instead of falling
      // back. Mapbox-with-ready lets the caller decide map or SVG as usual.
      console.warn('[imagery] tier resolution failed, falling back', err);
      if (!cancelled) setResolved({ ...MAPBOX, ready: true });
    });

    return () => {
      cancelled = true;
    };
    // `status` is in here so losing or regaining signal re-evaluates the tier.
  }, [courseId, remote.data, status]);

  return resolved ?? { ...MAPBOX, ready: false };
}
