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

import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getPackMeta, getRemotePackInfo } from '@/services/coursePackRepo';
import { isUsablyOnline } from '@/services/connectivity';
import { useConnectivity } from '@/features/offline/useConnectivity';
import { PROVIDER_NAME, isPmtilesProviderReady, prepareLocalPack } from './pmtilesSetup';

export type ImageryKind = 'local-pack' | 'remote-pack' | 'mapbox';

/**
 * How long the Mapbox tier stays disqualified after it fails to draw.
 *
 * Connectivity is measured against Supabase, and on a weak link the two don't
 * fail together: a tiny probe can still get through while Mapbox's tile
 * fan-out — dozens of requests, several MB — gets nowhere. That left the map
 * stuck on a tier that could not render while a downloaded pack sat unused on
 * the device. `reportMapboxUnusable()` is the map telling the tier list what
 * the probe cannot see.
 *
 * Time-boxed rather than sticky so a connection that recovers gets the sharper
 * imagery back without the golfer restarting anything.
 */
const MAPBOX_COOLDOWN_MS = 5 * 60_000;

/**
 * How long a connectivity change has to HOLD before the basemap follows it.
 *
 * Switching tiers tears the Mapbox map down and builds a new one — that is what
 * `imagery.kind`/`imagery.url` in HoleLayout's map effect does — and a rebuild
 * throws away the camera. Course wifi at the edge of its range flips
 * online↔degraded on nearly every request (`reportRequestSuccess` /
 * `reportRequestFailure` both move the status immediately, by design), so
 * without a dwell the map rebuilt every few seconds: a visible flash, and no
 * way to hold a zoom long enough to place a pin on the green.
 *
 * Asymmetric on purpose. Dropping to a pack is the safety net, so it can afford
 * to wait — and it doesn't have to wait when it matters, because a Mapbox that
 * genuinely cannot draw calls `reportMapboxUnusable()` and skips the dwell
 * entirely. Going back UP to Mapbox waits longer still: the pack renders fine,
 * so there is nothing to gain from being quick about it and everything to lose
 * from bouncing.
 */
const DEMOTE_DWELL_MS = 12_000;
const PROMOTE_DWELL_MS = 30_000;

let mapboxUnusableUntil = 0;
const mapboxListeners = new Set<() => void>();

/** Called by the map when Mapbox errors, or simply never draws. */
export function reportMapboxUnusable(): void {
  mapboxUnusableUntil = Date.now() + MAPBOX_COOLDOWN_MS;
  for (const l of mapboxListeners) l();
}

function mapboxUsable(): boolean {
  return Date.now() >= mapboxUnusableUntil;
}

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

/**
 * How long to wait before letting the map follow a tier change.
 *
 *   null → no change is needed; cancel anything pending.
 *   0    → switch now.
 *   > 0  → switch only if this is still the answer that many ms from now.
 *
 * Extracted from the hook so the rule is testable on its own. It is the whole
 * defence against a flapping connection rebuilding the map every few seconds.
 */
export function switchDelayMs(
  current: Pick<ImagerySource, 'kind' | 'url'> | null,
  next: Pick<ImagerySource, 'kind' | 'url'>,
  hardEvidence: boolean
): number | null {
  // Nothing on screen yet — there is no flash to avoid, and waiting would just
  // delay the first paint.
  if (!current) return 0;
  if (current.kind === next.kind && current.url === next.url) return null;
  // The map has reported it cannot draw this tier. That beats any probe.
  if (hardEvidence) return 0;
  return current.kind === 'mapbox' ? DEMOTE_DWELL_MS : PROMOTE_DWELL_MS;
}

export function useImagerySource(courseId: string | null | undefined): ImagerySource {
  const { status } = useConnectivity();
  const [resolved, setResolved] = useState<ImagerySource | null>(null);
  // Bumped when the map reports Mapbox unusable, so the tier list re-runs.
  const [mapboxVerdict, setMapboxVerdict] = useState(0);

  // What the map is currently drawing, and what we're waiting to switch it to.
  // Refs rather than state: the dwell has to survive the effect re-running,
  // which it does on every connectivity flip — the very thing being damped.
  const committedRef = useRef<ImagerySource | null>(null);
  const pendingRef = useRef<{
    kind: ImageryKind;
    url: string | null;
    timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const lastVerdictRef = useRef(0);

  useEffect(() => {
    const onChange = () => setMapboxVerdict((n) => n + 1);
    mapboxListeners.add(onChange);
    return () => {
      mapboxListeners.delete(onChange);
    };
  }, []);

  // Cancel any dwell in flight when the component goes away. Deliberately its
  // own effect with an empty dep list — putting this in the resolver's cleanup
  // would cancel the timer every time connectivity twitched, which is exactly
  // when it needs to keep running.
  useEffect(
    () => () => {
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    },
    []
  );

  // Remote availability is cached — it changes only when the tiler runs.
  const remote = useQuery({
    queryKey: ['course-pack-info', courseId],
    enabled: !!courseId && isUsablyOnline(),
    staleTime: 1000 * 60 * 60,
    queryFn: () => getRemotePackInfo(courseId as string)
  });

  useEffect(() => {
    let cancelled = false;

    const clearPending = () => {
      if (pendingRef.current) clearTimeout(pendingRef.current.timer);
      pendingRef.current = null;
    };

    const commit = (next: ImagerySource) => {
      clearPending();
      committedRef.current = next;
      setResolved(next);
    };

    /**
     * Move to `next` — but only once it has been the right answer for a while.
     *
     * The first resolution is immediate (there is nothing on screen to protect
     * yet), and so is one prompted by the map reporting it cannot draw. Every
     * other change waits out the dwell, and a flip back to what is already
     * showing simply cancels the wait — which is what turns a flapping
     * connection into a stable map.
     */
    const settle = (next: ImagerySource) => {
      if (cancelled) return;
      const current = committedRef.current;
      if (!current) {
        commit(next);
        return;
      }
      // The map itself telling us a tier doesn't render beats any probe, so it
      // takes effect at once rather than waiting out the dwell.
      const hardEvidence = mapboxVerdict !== lastVerdictRef.current;
      const dwell = switchDelayMs(current, next, hardEvidence);
      if (hardEvidence) lastVerdictRef.current = mapboxVerdict;

      if (dwell === null) {
        clearPending();
        return;
      }
      if (dwell === 0) {
        commit(next);
        return;
      }
      // Already counting down to this exact tier — let it finish.
      const pending = pendingRef.current;
      if (pending && pending.kind === next.kind && pending.url === next.url) return;

      clearPending();
      pendingRef.current = {
        kind: next.kind,
        url: next.url,
        timer: setTimeout(() => {
          pendingRef.current = null;
          committedRef.current = next;
          setResolved(next);
        }, dwell)
      };
    };

    (async () => {
      if (!courseId) {
        settle(MAPBOX);
        return;
      }

      // Without a working provider, PMTiles sources can't render at all — fall
      // straight through to Mapbox rather than producing a blank map.
      if (!isPmtilesProviderReady()) {
        settle(MAPBOX);
        return;
      }

      // Tier 1 — a usable connection means Mapbox, always. See the header:
      // deeper zooms and fresher imagery than anything we tile ourselves.
      // Unless the map has just told us Mapbox isn't drawing (see
      // MAPBOX_COOLDOWN_MS) — a tier that renders nothing isn't a tier.
      if (isUsablyOnline() && mapboxUsable()) {
        settle(MAPBOX);
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
          settle({
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

      // Tier 3 — degraded signal, or a Mapbox that won't draw on a connection
      // that otherwise works. `remote.data` may be a cached value from when the
      // signal was good, so gate on the live status rather than its presence:
      // fully offline, the ranged fetch can only hang and fail.
      const info = remote.data;
      const rangedReadWorthTrying = status === 'degraded' || (status === 'online' && !mapboxUsable());
      if (info && rangedReadWorthTrying) {
        settle({
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
      settle({ ...MAPBOX, ready: true });
    })().catch((err) => {
      // This MUST resolve to something. `HoleLayout` holds a placeholder while
      // `ready` is false to avoid flashing the SVG before a downloaded map
      // appears — so an unresolved tier would spin forever instead of falling
      // back. Mapbox-with-ready lets the caller decide map or SVG as usual.
      console.warn('[imagery] tier resolution failed, falling back', err);
      settle({ ...MAPBOX, ready: true });
    });

    return () => {
      cancelled = true;
    };
    // `status` is in here so losing or regaining signal re-evaluates the tier;
    // `mapboxVerdict` so a map that can't draw demotes itself.
  }, [courseId, remote.data, status, mapboxVerdict]);

  return resolved ?? { ...MAPBOX, ready: false };
}
