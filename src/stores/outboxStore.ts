// Rounds that are FINISHED but haven't reached Supabase yet.
//
// The active round lives in roundStore and is reconciled in place. But finishing
// a round clears `active`, and a golfer who played offline would otherwise have
// their round evaporate at exactly the moment they thought it was safe. So
// finishing parks an unsynced round here first, and it stays until the server
// confirms every row.
//
// Persisted to IndexedDB for the same reason as the active round: this is the
// only copy of several hours of play.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createIdbStorage } from '@/lib/idbStorage';
import type { ActiveRound } from './roundStore';

export interface PendingRound {
  /** Full local snapshot — everything needed to recreate the round remotely. */
  round: ActiveRound;
  /** Final score fields computed at finish time, applied with the round row. */
  completion: {
    score: number;
    scoreVsPar: number;
    completedAt: string;
  };
  queuedAt: string;
  /** Failed attempts, for backoff and for surfacing a stuck round to the user. */
  attempts: number;
  lastError?: string | null;
}

interface OutboxState {
  pending: PendingRound[];
  enqueue: (entry: PendingRound) => void;
  remove: (roundId: string) => void;
  recordFailure: (roundId: string, error: string) => void;
  /** Replace a queued snapshot after a partial sync, so progress isn't redone. */
  update: (roundId: string, round: ActiveRound) => void;
}

export const useOutboxStore = create<OutboxState>()(
  persist(
    (set) => ({
      pending: [],

      enqueue: (entry) =>
        set((s) => {
          // Keyed by round id — re-finishing the same round replaces rather
          // than duplicates it.
          const rest = s.pending.filter((p) => p.round.roundId !== entry.round.roundId);
          return { pending: [...rest, entry] };
        }),

      remove: (roundId) =>
        set((s) => ({ pending: s.pending.filter((p) => p.round.roundId !== roundId) })),

      recordFailure: (roundId, error) =>
        set((s) => ({
          pending: s.pending.map((p) =>
            p.round.roundId === roundId
              ? { ...p, attempts: p.attempts + 1, lastError: error }
              : p
          )
        })),

      update: (roundId, round) =>
        set((s) => ({
          pending: s.pending.map((p) => (p.round.roundId === roundId ? { ...p, round } : p))
        }))
    }),
    {
      name: 'grt-sync-outbox',
      storage: createJSONStorage(() => createIdbStorage('grt-sync-outbox'))
    }
  )
);
