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
import type {
  PracticeHealthSummary,
  SwingDetectedPayload,
  SwingMetric,
  SwingShotResult
} from '@/types/swing';

const store = useSwingSessionStore;

function localId(): string {
  return `swing_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function currentUserId(): string | null {
  return useAuthStore.getState().session?.user.id ?? null;
}

/**
 * In-flight session creation, so the burst of swing messages that arrive right
 * after `practiceStarted` (or all at once when a pocketed phone reconnects)
 * share ONE created session instead of racing to make 36 of them.
 */
let creating: Promise<string | null> | null = null;

/**
 * Return the active practice session id, creating one if none exists. This is
 * what makes watch-initiated practice work and guarantees swings are never
 * dropped — whoever arrives first (a `practiceStarted` message or the first
 * `swingDetected`) lazily opens the session.
 */
async function ensureSession(clubId: string | null, source?: string): Promise<string | null> {
  const existing = store.getState().session;
  if (existing) return existing.sessionId;
  if (creating) return creating;

  const userId = currentUserId();
  if (!userId) return null;

  creating = swingRepo
    .createSession({ userId, primaryClubId: clubId, source })
    .then((remote) => {
      // Guard against a concurrent caller having already opened one.
      if (!store.getState().session) {
        store.getState().startSession({
          sessionId: remote.id,
          watchSessionId: null,
          userId,
          startedAt: remote.startedAt,
          clubId
        });
      }
      creating = null;
      return store.getState().session?.sessionId ?? remote.id;
    })
    .catch((err) => {
      console.warn('[practice] ensureSession failed', err);
      creating = null;
      return null;
    });
  return creating;
}

export const practiceController = {
  /** Start a practice session (phone-initiated). Reuses one if already open.
   *  `source` tags the origin ('range' hides it from the Swing/Net history). */
  async start(clubId: string | null, source?: string): Promise<string | null> {
    return ensureSession(clubId, source);
  },

  /** Watch started practice: open/correlate the phone session. */
  onWatchPracticeStarted(watchSessionId: string, clubId: string | null): void {
    void ensureSession(clubId).then((sessionId) => {
      if (!sessionId) return;
      const st = store.getState();
      st.setWatchSessionId(watchSessionId);
      if (clubId) st.setClub(clubId);
    });
  },

  onWatchClubSelected(clubId: string): void {
    store.getState().setClub(clubId);
  },

  setClub(clubId: string | null): void {
    store.getState().setClub(clubId);
  },

  /** Ingest one swing streamed from the watch: add locally + persist. */
  async ingestSwing(payload: SwingDetectedPayload): Promise<void> {
    // Open a session if one isn't active yet (watch-initiated practice, or a
    // queued burst arriving after the phone reconnected). Without this the
    // swing would be silently dropped.
    const sessionId = await ensureSession(payload.clubId ?? null);
    const session = store.getState().session;
    if (!sessionId || !session) {
      console.warn('[practice] dropped swing — no session and could not create one');
      return;
    }

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
      swingType: payload.swingType ?? null,
      isAirSwing: payload.isAirSwing ?? false,
      backswingRotation: payload.backswingRotation ?? null,
      releaseTimingScore: payload.releaseTimingScore ?? null,
      decelerationScore: payload.decelerationScore ?? null,
      transitionDirectionScore: payload.transitionDirectionScore ?? null,
      addressGravity: payload.addressGravity ?? [],
      heartRate: payload.heartRate ?? null,
      shotResult: null,
      remoteId: null
    };

    const feedback = evaluateSwing(swing);
    store.getState().addSwing(swing, feedback);

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
        swingType: swing.swingType,
        isAirSwing: swing.isAirSwing,
        backswingRotation: swing.backswingRotation,
        releaseTimingScore: swing.releaseTimingScore,
        decelerationScore: swing.decelerationScore,
        transitionDirectionScore: swing.transitionDirectionScore,
        addressGravity: swing.addressGravity,
        heartRate: swing.heartRate,
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

  /** End the session: compute session rollups + baseline feedback, persist
   *  (including the optional health summary from the watch). */
  async end(health?: PracticeHealthSummary): Promise<string | null> {
    const st = store.getState();
    const session = st.session;
    if (!session) return null;

    let baseline;
    try {
      baseline = await swingRepo.getUserBaseline(session.userId);
    } catch (err) {
      console.warn('[practice] baseline lookup failed', err);
    }

    // Evaluate against the authoritative swing set. The in-memory store can lag
    // the DB when swings arrive as a queued burst (pocketed phone), so pull the
    // persisted rows and use whichever set is larger — this keeps the saved
    // rollup (shown in the Past Practices list) in sync with the real swings.
    let dbSwings: typeof st.swings = [];
    try {
      dbSwings = await swingRepo.listSwings(session.sessionId);
    } catch (err) {
      console.warn('[practice] listSwings during end failed', err);
    }
    const localSwings = store.getState().swings;
    const swings = dbSwings.length >= localSwings.length ? dbSwings : localSwings;

    const evaluation = evaluateSession(swings, baseline);

    // Persist per-swing relative scores to the DB. `evaluation.perSwing` is
    // keyed by the evaluated set's ids; each evaluated swing carries a
    // remoteId (DB rows) or its own id is the remote id.
    for (const swing of swings) {
      const scores = evaluation.perSwing[swing.id];
      if (!scores) continue;
      const remoteId = swing.remoteId ?? swing.id;
      try {
        await swingRepo.updateSwingScores(remoteId, scores);
      } catch (err) {
        console.warn('[practice] updateSwingScores failed', err);
      }
    }

    // Reflect the scores in the in-memory store so the just-ended summary's
    // swing cards show them, matching DB rows by remoteId.
    const scoresByRemote = new Map(
      swings.map((s) => [s.remoteId ?? s.id, evaluation.perSwing[s.id]])
    );
    for (const local of store.getState().swings) {
      const scores = local.remoteId
        ? scoresByRemote.get(local.remoteId)
        : evaluation.perSwing[local.id];
      if (scores) store.getState().setSwingScores(local.id, scores);
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
      await swingRepo.endSession(session.sessionId, evaluation.rollup, health);
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
