// The traffic-driven half of connectivity: a stalled request is the earliest
// and most reliable evidence that the link has gone bad on a course, and a
// passing probe must not immediately overrule it.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus: vi.fn(async () => ({ connected: true, connectionType: 'cellular' })),
    addListener: vi.fn(async () => ({ remove: vi.fn() }))
  }
}));

async function loadModule() {
  vi.resetModules();
  return import('./connectivity');
}

beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://example.supabase.co');
  // A probe that always passes — the exact condition that made the old code
  // insist everything was fine while real queries hung.
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })));
  // Node environment — the module reads the simulate-offline flag from here.
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k)
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('connectivity', () => {
  it('demotes to degraded the moment a request times out', async () => {
    const c = await loadModule();
    expect(c.getConnectivity().status).toBe('online');

    c.reportRequestFailure('timeout');

    expect(c.getConnectivity().status).toBe('degraded');
    expect(c.isUsablyOnline()).toBe(false);
  });

  it('does not let a passing probe undo a fresh timeout', async () => {
    const c = await loadModule();
    c.reportRequestFailure('timeout');

    // The probe passes (see the fetch stub) — but a tiny health check getting
    // through says nothing about the query that just died.
    await c.refreshConnectivity();

    expect(c.getConnectivity().status).toBe('degraded');
  });

  it('promotes again on a genuine request success', async () => {
    const c = await loadModule();
    c.reportRequestFailure('timeout');

    c.reportRequestSuccess();

    expect(c.getConnectivity().status).toBe('online');
  });

  it('ignores traffic reports while simulate-offline is on', async () => {
    const c = await loadModule();
    c.setSimulatedOffline(true);
    await c.refreshConnectivity();

    c.reportRequestSuccess();

    expect(c.getConnectivity().status).toBe('offline');
  });
});
