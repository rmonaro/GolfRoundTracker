import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SwingFeedback, SwingMetric, SwingShotResult } from '@/types/swing';
import type { SessionRollup } from '@/services/swingFeedbackEngine';

/**
 * Live practice-session state. Holds the in-progress session, the swings
 * streamed in from the watch, and the rules-engine feedback. Async I/O
 * (Supabase persistence, baseline lookup) lives in `usePracticeSession` —
 * this store is pure UI state so it stays testable and the round flow is
 * completely untouched.
 *
 * Persisted locally so a backgrounded app / refresh mid-session doesn't lose
 * swings that already arrived from the watch.
 */

export interface ActivePracticeSession {
  /** Supabase swing_sessions id. */
  sessionId: string;
  /** Watch-minted session id, used to correlate inbound swing messages. */
  watchSessionId: string | null;
  userId: string;
  startedAt: string;
  clubId: string | null;
  /** Origin of this session: 'practice' = Swing/Net, 'range' = Range/Drills. */
  source: string;
}

interface SwingSessionState {
  session: ActivePracticeSession | null;
  swings: SwingMetric[];
  /** Per-swing rules feedback, keyed by local swing id. */
  feedbackBySwing: Record<string, SwingFeedback[]>;
  /** Session-level feedback (consistency, fatigue), filled at end-of-session. */
  sessionFeedback: SwingFeedback[];
  rollup: SessionRollup | null;

  startSession: (s: ActivePracticeSession) => void;
  setClub: (clubId: string | null) => void;
  setWatchSessionId: (watchSessionId: string) => void;
  addSwing: (swing: SwingMetric, feedback: SwingFeedback[]) => void;
  markSwingPersisted: (localId: string, remoteId: string) => void;
  setSwingScores: (
    localId: string,
    scores: { swingConsistencyScore: number; planeConsistencyScore: number }
  ) => void;
  setShotResult: (localId: string, result: SwingShotResult) => void;
  applySessionEvaluation: (sessionFeedback: SwingFeedback[], rollup: SessionRollup) => void;
  endSession: () => void;
  reset: () => void;
}

export const useSwingSessionStore = create<SwingSessionState>()(
  persist(
    (set) => ({
      session: null,
      swings: [],
      feedbackBySwing: {},
      sessionFeedback: [],
      rollup: null,

      startSession: (s) =>
        set({ session: s, swings: [], feedbackBySwing: {}, sessionFeedback: [], rollup: null }),

      setClub: (clubId) =>
        set((st) => (st.session ? { session: { ...st.session, clubId } } : st)),

      setWatchSessionId: (watchSessionId) =>
        set((st) => (st.session ? { session: { ...st.session, watchSessionId } } : st)),

      addSwing: (swing, feedback) =>
        set((st) => ({
          swings: [...st.swings, swing],
          feedbackBySwing: { ...st.feedbackBySwing, [swing.id]: feedback }
        })),

      markSwingPersisted: (localId, remoteId) =>
        set((st) => ({
          swings: st.swings.map((s) => (s.id === localId ? { ...s, remoteId } : s))
        })),

      setSwingScores: (localId, scores) =>
        set((st) => ({
          swings: st.swings.map((s) =>
            s.id === localId
              ? {
                  ...s,
                  swingConsistencyScore: scores.swingConsistencyScore,
                  planeConsistencyScore: scores.planeConsistencyScore
                }
              : s
          )
        })),

      setShotResult: (localId, result) =>
        set((st) => ({
          swings: st.swings.map((s) => (s.id === localId ? { ...s, shotResult: result } : s))
        })),

      applySessionEvaluation: (sessionFeedback, rollup) => set({ sessionFeedback, rollup }),

      endSession: () => set({ session: null }),

      reset: () =>
        set({ session: null, swings: [], feedbackBySwing: {}, sessionFeedback: [], rollup: null })
    }),
    {
      name: 'grt-practice-session',
      partialize: (state) => ({
        session: state.session,
        swings: state.swings,
        feedbackBySwing: state.feedbackBySwing,
        sessionFeedback: state.sessionFeedback,
        rollup: state.rollup
      })
    }
  )
);
