import { describe, expect, it } from 'vitest';
import { resolveTournamentAccess, type AccessSignals } from './resolveTournamentAccess';

const signals = (over: Partial<AccessSignals> = {}): AccessSignals => ({
  hasUser: true,
  tournamentCount: 0,
  scorerGroupCount: 0,
  tournamentsSettled: true,
  scorerSettled: true,
  tournamentsUnavailable: false,
  scorerUnavailable: false,
  ...over
});

describe('resolveTournamentAccess', () => {
  it('grants access on a registered event', () => {
    const r = resolveTournamentAccess(signals({ tournamentCount: 1 }));
    expect(r).toMatchObject({ hasAccess: true, isResolving: false, isUnknown: false });
  });

  it('grants access on a scoring assignment alone', () => {
    const r = resolveTournamentAccess(signals({ scorerGroupCount: 2 }));
    expect(r.hasAccess).toBe(true);
  });

  it('reports no access once both live pulls settle empty', () => {
    const r = resolveTournamentAccess(signals());
    expect(r).toMatchObject({ hasAccess: false, isResolving: false, isUnknown: false });
  });

  // The bug this function exists for: on a fresh login the cached snapshots
  // resolve instantly and empty while the live scorer pull is still in flight.
  // Reading that as "no access" skipped the chooser for a real scorekeeper.
  it('keeps resolving while the live scorer pull is in flight', () => {
    const r = resolveTournamentAccess(signals({ scorerSettled: false }));
    expect(r).toMatchObject({ hasAccess: false, isResolving: true });
  });

  it('keeps resolving while the live entitlements pull is in flight', () => {
    const r = resolveTournamentAccess(signals({ tournamentsSettled: false }));
    expect(r.isResolving).toBe(true);
  });

  it('keeps resolving until a session exists', () => {
    const r = resolveTournamentAccess(signals({ hasUser: false }));
    expect(r.isResolving).toBe(true);
  });

  it('stops resolving as soon as access is proven, even mid-flight', () => {
    const r = resolveTournamentAccess(
      signals({ scorerGroupCount: 1, tournamentsSettled: false, scorerSettled: false })
    );
    expect(r).toMatchObject({ hasAccess: true, isResolving: false });
  });

  it('marks access unknown when a source failed with no snapshot', () => {
    const r = resolveTournamentAccess(signals({ tournamentsUnavailable: true }));
    expect(r).toMatchObject({ hasAccess: false, isResolving: false, isUnknown: true });
  });

  it('is not unknown while still resolving', () => {
    const r = resolveTournamentAccess(
      signals({ scorerSettled: false, tournamentsUnavailable: true })
    );
    expect(r).toMatchObject({ isResolving: true, isUnknown: false });
  });

  it('is not unknown when a failure was covered by a snapshot', () => {
    const r = resolveTournamentAccess(signals({ tournamentsUnavailable: false }));
    expect(r.isUnknown).toBe(false);
  });

  it('passes the counts through', () => {
    const r = resolveTournamentAccess(signals({ tournamentCount: 3, scorerGroupCount: 4 }));
    expect(r).toMatchObject({ tournamentCount: 3, scorerGroupCount: 4 });
  });
});
