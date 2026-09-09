// Resume a round that was started on ANOTHER device.
//
// An in-progress round lives in the local store (`grt-active-round`, persisted
// to this device's IndexedDB) and nothing hydrates it from Supabase — so the
// resume card is device-local, and a golfer who starts on their phone and picks
// up a tablet sees nothing to continue. The round itself is fine: live rounds
// are pushed by `syncLiveRounds` with `completed_at: null`, so the server has
// it. It was simply never looked at — `PastRoundsPage` shows only completed
// rounds, so an in-progress one is fetched and then filtered out of every view.
//
// This closes that. The pull half already existed for tournament rounds
// (`useStartRound` → `hydrateFromRemote`); all that was missing was noticing
// the round and offering it.

import { useMemo } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRounds } from '@/features/stats/useRounds';
import { useRoundStore } from '@/stores/roundStore';
import { useAuthStore } from '@/stores/authStore';
import { roundRepo } from '@/services/roundRepo';
import type { Round } from '@/models';

/**
 * How recently a round must have started to count as "in progress somewhere
 * else" rather than "abandoned".
 *
 * This matters more than it looks. Nothing in the app has ever deleted an
 * unfinished round — `startRound` replaces the local `active` outright, so
 * every round a golfer walked away from is still sitting on the server with
 * `completed_at` null. Offering the newest of those as a live round turns a pile
 * of old junk into a permanent "in progress on another device" banner. A round
 * takes at most five or six hours; twelve covers one started in the morning and
 * picked up after lunch, and excludes anything from a previous day.
 *
 * Older unfinished rounds are not hidden — they are listed, resumable and
 * deletable under Past Rounds → Unfinished. They just stop shouting.
 */
const LIVE_WINDOW_MS = 12 * 60 * 60 * 1000;

/**
 * The newest in-progress round on the server that this device isn't already
 * tracking and that is recent enough to still be live, or null.
 *
 * Reuses `useRounds()` — the same cached query the page already runs for the
 * "last round" card — rather than adding a request. In-progress rounds are in
 * that payload already; they were just being filtered out everywhere.
 */
export function useRemoteLiveRound(): Round | null {
  const { data: rounds } = useRounds();
  const hydrated = useRoundStore((s) => s.hydrated);
  const active = useRoundStore((s) => s.active);
  const parked = useRoundStore((s) => s.parked);
  const userId = useAuthStore((s) => s.session?.user.id);

  return useMemo(() => {
    // `hydrated` is false until the persisted round has been read back out of
    // IndexedDB, and that read is async. Answering before it lands would offer
    // the golfer a "round from another device" that is in fact the round on
    // THIS device, one render before the store catches up.
    if (!hydrated || !userId) return null;

    // A round being tracked here is not a round from somewhere else. `parked`
    // matters for scorer mode, where 2-4 cards are live at once.
    const known = new Set<string>();
    if (active) known.add(active.roundId);
    for (const r of Object.values(parked)) known.add(r.roundId);

    const cutoff = Date.now() - LIVE_WINDOW_MS;
    const candidates = (rounds ?? []).filter(
      (r) =>
        !r.completed_at &&
        r.user_id === userId &&
        !known.has(r.id) &&
        new Date(r.started_at).getTime() >= cutoff
    );
    if (candidates.length === 0) return null;
    // `listForUser` already orders by started_at desc.
    return candidates[0];
  }, [rounds, hydrated, active, parked, userId]);
}

/**
 * Pull a remote round down and make it the round on screen.
 *
 * Takes over rather than mirrors: after this the tablet is the device holding
 * the round, and its writes are the ones that count. The phone still has its
 * own copy and would keep writing if used, and shot upserts are last-writer-
 * wins — so this is offered only when this device has NO round of its own (see
 * `useRemoteLiveRound`, and the guard below), which keeps the two devices from
 * both being live by accident.
 */
export function useResumeRemoteRound() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (round: Round) => {
      // Refuse rather than clobber. `hydrateFromRemote` overwrites `active`
      // wholesale, and a local round can hold shots that have never reached the
      // server — the one thing in this app that genuinely cannot be recovered.
      if (useRoundStore.getState().active) {
        throw new Error(
          'Finish or delete the round on this device before resuming a round from another one.'
        );
      }
      const [holes, shots] = await Promise.all([
        roundRepo.listHoles(round.id),
        roundRepo.listShots(round.id)
      ]);
      useRoundStore.getState().hydrateFromRemote(round, holes, shots);
      return round;
    },
    onSuccess: (round) => {
      // The round's own rows changed hands; anything showing it should refetch.
      queryClient.invalidateQueries({ queryKey: ['rounds', round.user_id] });
    }
  });
}
