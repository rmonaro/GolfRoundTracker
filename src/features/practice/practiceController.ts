// Async orchestration for the watch practice session. Kept as a singleton
// module (not a hook) so the swing-ingest path binds exactly once at the app
// root and never double-persists when several practice screens are mounted.
//
// State lives in `swingSessionStore`; persistence goes through `swingRepo`.
// Pages call these actions and read the store via hooks.

import { useAuthStore } from '@/stores/authStore';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { swingRepo } from '@/services/swingRepo';
import { evaluateSession, evaluateSwing } from '@/services/swingFeedbackEngine';
import type { SwingDetectedPayload, SwingMetric, SwingShotResult } from '@/types/swing';

const store = useSwingSessionStore;

function localId(): string {
  return `swing_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function currentUserId(): string | null {
  return useAuthStore.getState().session?.user.id ?? null;
}

export const practiceController = {
  /** Start a practice session (phone-initiated). */
  async start(clubId: string | null): Promise<string | null> {
    const userId = currentUserId();
    if (!userId) return null;
    const remote = await swingRepo.createSession({ userId, primaryClubId: clubId });
    store.getState().startSession({
      sessionId: remote.id,
      watchSessionId: null,
      userId,
      startedAt: remote.startedAt,
      clubId
    });
    return remote.id;
  },

  /** Correlate a watch-minted session id with the active phone session. */
  onWatchPracticeStarted(watchSessionId: string, clubId: string | null): void {
    const st = store.getState();
    if (!st.session) return; // V1: phone "Start" creates the session first.
    st.setWatchSessionId(watchSessionId);
    if (clubId) st.setClub(clubId);
  },

  onWatchClubSelected(clubId: string): void {
    store.getState().setClub(clubId);
  },

  setClub(clubId: string | null): void {
    store.getState().setClub(clubId);
  },

  /** Ingest one swing streamed from the watch: add locally + persist. */
  async ingestSwing(payload: SwingDetectedPayload): Promise<void> {
    const st = store.getState();
    const session = st.session;
    if (!session) return; // No active session — ignore (bounded V1 behaviour).

    const id = localId();
    const swing: SwingMetric = {
      id,
      sessionId: session.sessionId,
      swingIndex: payload.swingIndex,
      clubId: payload.clubId ?? session.clubId,
      capturedAt: new Date(payload.capturedAt * 1000).toISOString(),
      backswingTimeMs: payload.backswingTimeMs,
      downswingTimeMs: payload.downswingTimeMs,
      tempoRatio: payload.tempoRatio,
      transitionScore: payload.transitionScore,
      estimatedHandSpeed: payload.estimatedHandSpeed,
      wristRotationScore: payload.wristRotationScore,
      finishStabilityScore: payload.finishStabilityScore,
      swingConsistencyScore: null,
      planeConsistencyScore: null,
      planeAxis: payload.planeAxis ?? [],
      shotResult: null,
      remoteId: null
    };

    const feedback = evaluateSwing(swing);
    st.addSwing(swing, feedback);

    // Persist (best-effort; the swing is already visible locally).
    try {
      const saved = await swingRepo.saveSwing({
        sessionId: session.sessionId,
        userId: session.userId,
        swingIndex: swing.swingIndex,
        clubId: swing.clubId,
        capturedAt: swing.capturedAt,
        backswingTimeMs: swing.backswingTimeMs,
        downswingTimeMs: swing.downswingTimeMs,
        tempoRatio: swing.tempoRatio,
        transitionScore: swing.transitionScore,
        estimatedHandSpeed: swing.estimatedHandSpeed,
        wristRotationScore: swing.wristRotationScore,
        finishStabilityScore: swing.finishStabilityScore,
        planeAxis: swing.planeAxis,
        shotResult: swing.shotResult
      });
      store.getState().markSwingPersisted(id, saved.remoteId ?? saved.id);
      for (const f of feedback) {
        await swingRepo.saveFeedback({
          sessionId: session.sessionId,
          swingId: saved.remoteId ?? saved.id,
          level: f.level,
          code: f.code,
          message: f.message,
          source: 'rules'
        });
      }
    } catch (err) {
      console.warn('[practice] saveSwing failed', err);
    }
  },

  /** Attach an optional manual shot result to a swing. */
  async setShotResult(localSwingId: string, result: SwingShotResult): Promise<void> {
    store.getState().setShotResult(localSwingId, result);
    const remoteId = await waitForRemoteId(localSwingId);
    if (!remoteId) return;
    try {
      await swingRepo.setShotResult(remoteId, result);
    } catch (err) {
      console.warn('[practice] setShotResult failed', err);
    }
  },

  /** End the session: compute session rollups + baseline feedback, persist. */
  async end(): Promise<string | null> {
    const st = store.getState();
    const session = st.session;
    if (!session) return null;

    let baseline;
    try {
      baseline = await swingRepo.getUserBaseline(session.userId);
    } catch (err) {
      console.warn('[practice] baseline lookup failed', err);
    }

    const evaluation = evaluateSession(st.swings, baseline);

    // Backfill per-swing relative scores (local + remote).
    for (const swing of st.swings) {
      const scores = evaluation.perSwing[swing.id];
      if (!scores) continue;
      store.getState().setSwingScores(swing.id, scores);
      if (swing.remoteId) {
        try {
          await swingRepo.updateSwingScores(swing.remoteId, scores);
        } catch (err) {
          console.warn('[practice] updateSwingScores failed', err);
        }
      }
    }

    store.getState().applySessionEvaluation(evaluation.feedback, evaluation.rollup);

    try {
      for (const f of evaluation.feedback) {
        await swingRepo.saveFeedback({
          sessionId: session.sessionId,
          swingId: null,
          level: f.level,
          code: f.code,
          message: f.message,
          source: 'rules'
        });
      }
      await swingRepo.endSession(session.sessionId, evaluation.rollup);
    } catch (err) {
      console.warn('[practice] endSession failed', err);
    }

    const id = session.sessionId;
    store.getState().endSession(); // clears active session, keeps swings for summary
    return id;
  }
};

/** Briefly poll for a swing's remote id (it persists async right after add). */
async function waitForRemoteId(localSwingId: string, tries = 10): Promise<string | null> {
  for (let i = 0; i < tries; i++) {
    const swing = store.getState().swings.find((s) => s.id === localSwingId);
    if (swing?.remoteId) return swing.remoteId;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}
