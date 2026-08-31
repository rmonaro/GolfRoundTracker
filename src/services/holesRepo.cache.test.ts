// Weak-signal behaviour of `holesRepo.getLayout`.
//
// The bug these pin: a golfer whose signal fades mid-round (rather than dropping
// cleanly) sat on the hole screen's spinner indefinitely, because connectivity
// still said `online` and `fetch` has no timeout. Toggling "simulate offline" by
// hand was the only way to get the already-downloaded course to render.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CachedCourse } from './courseCacheRepo';

const mocks = vi.hoisted(() => ({
  isUsablyOnline: vi.fn(() => true),
  getCachedCourse: vi.fn(),
  from: vi.fn()
}));

vi.mock('./connectivity', () => ({ isUsablyOnline: mocks.isUsablyOnline }));
vi.mock('./courseCacheRepo', () => ({ getCachedCourse: mocks.getCachedCourse }));
vi.mock('@/lib/supabase', () => ({ supabase: { from: mocks.from } }));

const { holesRepo } = await import('./holesRepo');

const CACHED: CachedCourse = {
  version: 1,
  courseId: 'c1',
  courseName: 'Test GC',
  osmStatus: 'ready',
  holes: [
    {
      id: 'h1',
      course_id: 'c1',
      hole_number: 1,
      tee_lng: -74.0,
      tee_lat: 40.0,
      green_lng: -74.0,
      green_lat: 40.004,
      centerline: [
        [-74.0, 40.0],
        [-74.0, 40.004]
      ]
    }
  ] as unknown as CachedCourse['holes'],
  features: [],
  downloadedAt: new Date().toISOString(),
  sizeBytes: 0
};

/** A PostgREST chain whose terminal read never settles — one bar of LTE. */
function stallingChain() {
  const chain: Record<string, unknown> = {};
  const never = new Promise(() => {});
  for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => never);
  chain.then = (...args: unknown[]) =>
    (never as Promise<unknown>).then(...(args as Parameters<Promise<unknown>['then']>));
  return chain;
}

beforeEach(() => {
  mocks.isUsablyOnline.mockReturnValue(true);
  mocks.getCachedCourse.mockReset();
  mocks.from.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('getLayout under weak signal', () => {
  it('falls back to the cached course when the request stalls', async () => {
    vi.useFakeTimers();
    mocks.getCachedCourse.mockResolvedValue(CACHED);
    mocks.from.mockImplementation(() => stallingChain());

    const promise = holesRepo.getLayout('c1', 1);
    // Past the patience window, still well inside the stalled request.
    await vi.advanceTimersByTimeAsync(4000);

    const result = await promise;
    expect(result.data?.hole.id).toBe('h1');
    expect(result.courseStatus).toBe('ready');
  });

  it('serves the cache without touching the network when known-offline', async () => {
    mocks.isUsablyOnline.mockReturnValue(false);
    mocks.getCachedCourse.mockResolvedValue(CACHED);

    const result = await holesRepo.getLayout('c1', 1);

    expect(result.data?.hole.id).toBe('h1');
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it('lets the request fail normally when there is nothing cached', async () => {
    mocks.getCachedCourse.mockResolvedValue(null);
    const chain: Record<string, unknown> = {};
    for (const m of ['select', 'eq']) chain[m] = vi.fn(() => chain);
    chain.maybeSingle = vi.fn(() => Promise.resolve({ data: null, error: { message: 'boom' } }));
    mocks.from.mockImplementation(() => chain);

    await expect(holesRepo.getLayout('c1', 1)).rejects.toThrow(/boom/);
  });
});
