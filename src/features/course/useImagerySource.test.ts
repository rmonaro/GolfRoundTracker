import { describe, expect, it } from 'vitest';
import { switchDelayMs } from './useImagerySource';

const mapbox = { kind: 'mapbox' as const, url: null };
const localPack = { kind: 'local-pack' as const, url: 'grt-pack://course-1' };
const remotePack = { kind: 'remote-pack' as const, url: 'https://cdn/pack.pmtiles' };

describe('switchDelayMs', () => {
  it('paints the first tier immediately', () => {
    // Nothing on screen yet, so there is no flash to protect and waiting would
    // only delay the map appearing at all.
    expect(switchDelayMs(null, mapbox, false)).toBe(0);
    expect(switchDelayMs(null, localPack, false)).toBe(0);
  });

  it('does nothing when the tier is already what is showing', () => {
    expect(switchDelayMs(mapbox, mapbox, false)).toBeNull();
    expect(switchDelayMs(localPack, { ...localPack }, false)).toBeNull();
  });

  it('treats a different pack URL as a real change', () => {
    // A pack finishing its download replaces a remote read with a local one.
    expect(switchDelayMs(remotePack, localPack, false)).toBeGreaterThan(0);
  });

  it('makes leaving Mapbox wait, so a flapping connection cannot rebuild the map', () => {
    // This is the bug: course wifi at the edge of range flips online/degraded
    // on nearly every request, and each flip used to tear the map down.
    const delay = switchDelayMs(mapbox, localPack, false);
    expect(delay).toBeGreaterThan(0);
  });

  it('makes coming back to Mapbox wait even longer', () => {
    // A pack renders fine, so there is nothing to gain from switching back
    // quickly and everything to lose from bouncing.
    const down = switchDelayMs(mapbox, localPack, false)!;
    const up = switchDelayMs(localPack, mapbox, false)!;
    expect(up).toBeGreaterThan(down);
  });

  it('switches at once when the map reports it cannot draw', () => {
    // reportMapboxUnusable() is the map saying tiles are not arriving, which is
    // stronger evidence than any connectivity probe — so it skips the dwell.
    expect(switchDelayMs(mapbox, localPack, true)).toBe(0);
    expect(switchDelayMs(localPack, mapbox, true)).toBe(0);
  });

  it('still reports no change on hard evidence when the tier is unchanged', () => {
    // Otherwise a repeated failure report would commit the same tier over and
    // over, and each commit rebuilds the map.
    expect(switchDelayMs(mapbox, mapbox, true)).toBeNull();
  });
});
