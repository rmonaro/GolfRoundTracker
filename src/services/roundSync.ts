// Round → Supabase reconciler.
//
// A RECONCILER, not a mutation log: it walks the local round (which is already
// the source of truth and already persisted) and upserts whatever the server is
// missing. A parallel append-only log of "things that happened" would be a
// second source of truth that can drift from the store; this cannot.
//
// Everything is keyed on client-minted UUIDs (Phase 1), so every write is an
// upsert and running this twice is a no-op rather than a duplicate round.
//
// ORDER IS NOT OPTIONAL. The RLS policies on `round_holes` and `shots` are both
//   exists (select 1 from rounds r where r.id = <table>.round_id and r.user_id = auth.uid())
// so a hole or shot pushed before its parent round is rejected outright — not
// as a foreign-key error, but as an RLS denial. Round → holes → shots, always.

import { roundRepo } from './roundRepo';
import { supabase } from '@/lib/supabase';
import { isUsablyOnline, refreshConnectivity } from './connectivity';
import { useRoundStore, type ActiveRound, type LocalHole } from '@/stores/roundStore';
import { useOutboxStore, type PendingRound } from '@/stores/outboxStore';

export interface SyncResult {
  ok: boolean;
  syncedShots: number;
  /** Set when the failure is auth-related, which needs the user, not a retry. */
  needsAuth?: boolean;
  error?: string;
}

/** Rows the server is missing or that changed since their last successful push. */
function unsyncedHoles(round: ActiveRound): LocalHole[] {
  return round.holes.filter((h) => !h.syncedAt || h.dirty);
}

function unsyncedShots(round: ActiveRound) {
  return round.holes.flatMap((h) =>
    h.shots.filter((s) => !s.syncedAt).map((s) => ({ hole: h, shot: s }))
  );
}

/** Does this round have anything at all waiting to go up? */
export function pendingCount(round: ActiveRound | null): number {
  if (!round) return 0;
  return (
    unsyncedShots(round).length +
    unsyncedHoles(round).length +
    (round.deletedShotIds?.length ?? 0) +
    (round.roundSyncedAt ? 0 : 1)
  );
}

function holePayload(round: ActiveRound, h: LocalHole) {
  return {
    id: h.holeId,
    round_id: round.roundId,
    hole_number: h.holeNumber,
    par: h.par,
    yardage: h.yardage,
    strokes: h.strokes,
    putts: h.putts,
    penalty_strokes: h.penaltyStrokes,
    fairway_result: h.fairwayResult,
    sand: h.sand,
    gir: h.gir,
    clubs_used: h.clubsUsed
  };
}

function roundPayload(round: ActiveRound, completion?: PendingRound['completion']) {
  return {
    id: round.roundId,
    user_id: round.userId,
    course_id: round.courseId,
    course_name: round.courseName,
    holes_played: round.holesPlayed,
    score: completion?.score ?? 0,
    par: round.totalPar,
    score_vs_par: completion?.scoreVsPar ?? 0,
    started_at: round.startedAt,
    completed_at: completion?.completedAt ?? null,
    course_rating: round.courseRating,
    slope_rating: round.slopeRating,
    estimated_handicap: null,
    handicap_differential: null,
    tm_registration_id: round.tmRegistrationId ?? null,
    tm_round_number: round.tmRoundNumber ?? null,
    tm_tournament_slug: round.tmTournamentSlug ?? null,
    tee_id: round.teeId ?? null,
    tee_name: round.teeName ?? null
  };
}

/**
 * An expired session looks like a normal failure but must NOT be retried in a
 * loop — it needs the user to sign in. Detected so the caller can stop and say
 * so rather than burning battery on a doomed backoff.
 */
function isAuthError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /jwt|token|unauthor|401|refresh/i.test(msg);
}

/**
 * Push one round and everything under it. Returns rather than throws — callers
 * are background triggers where an exception is just noise.
 */
export async function syncRound(
  round: ActiveRound,
  completion?: PendingRound['completion']
): Promise<SyncResult & { syncedHoleIds: string[]; syncedShotIds: string[]; deletedIds: string[] }> {
  const empty = { syncedHoleIds: [] as string[], syncedShotIds: [] as string[], deletedIds: [] as string[] };

  try {
    // 1. The round row. Unconditional: it's one cheap upsert, and every write
    //    below is rejected by RLS without it. Re-pushing also carries the final
    //    score when finishing.
    await roundRepo.create(roundPayload(round, completion));

    // 2. Holes. Batched — 18 rows in one request, not 18 requests.
    const holes = unsyncedHoles(round);
    if (holes.length > 0) {
      await roundRepo.upsertHoles(holes.map((h) => holePayload(round, h)));
    }

    // 3. Shots, now that their parent holes exist.
    const shots = unsyncedShots(round);
    for (const { hole, shot } of shots) {
      await roundRepo.addShot({
        id: shot.id,
        round_id: round.roundId,
        hole_id: hole.holeId,
        shot_number: shot.shotNumber,
        club_id: shot.clubId,
        shot_result: shot.shotResult,
        target_type: shot.targetType,
        target_result: shot.targetResult,
        lie: shot.lie,
        penalty_type: shot.penaltyType,
        distance: shot.distance,
        distance_unit: shot.distanceUnit,
        notes: shot.notes,
        start_lat: shot.startLat ?? null,
        start_lng: shot.startLng ?? null,
        end_lat: shot.endLat ?? null,
        end_lng: shot.endLng ?? null,
        calculated_distance: shot.calculatedDistance ?? null,
        verified: shot.verified ?? true
      });
    }

    // 4. Tombstones last: deleting before the upserts above would let a shot
    //    that's still in the local list get re-created by step 3.
    const deletedIds: string[] = [];
    for (const id of round.deletedShotIds ?? []) {
      await roundRepo.deleteShot(id);
      deletedIds.push(id);
    }

    return {
      ok: true,
      syncedShots: shots.length,
      syncedHoleIds: holes.map((h) => h.holeId),
      syncedShotIds: shots.map((s) => s.shot.id),
      deletedIds
    };
  } catch (err) {
    return {
      ok: false,
      syncedShots: 0,
      needsAuth: isAuthError(err),
      error: err instanceof Error ? err.message : String(err),
      ...empty
    };
  }
}

/** Push the in-progress round and stamp what landed. */
export async function reconcileActiveRound(): Promise<SyncResult> {
  const store = useRoundStore.getState();
  const round = store.active;
  if (!round) return { ok: true, syncedShots: 0 };
  if (pendingCount(round) === 0) return { ok: true, syncedShots: 0 };

  const result = await syncRound(round);
  if (!result.ok) return result;

  store.markRoundSynced();
  store.markSynced(result.syncedHoleIds, result.syncedShotIds);
  if (result.deletedIds.length > 0) store.clearShotTombstones(result.deletedIds);
  return { ok: true, syncedShots: result.syncedShots };
}

/** Push every finished-but-unsynced round, oldest first. */
export async function drainOutbox(): Promise<SyncResult> {
  const outbox = useOutboxStore.getState();
  let synced = 0;

  for (const entry of [...outbox.pending]) {
    const result = await syncRound(entry.round, entry.completion);
    if (result.ok) {
      synced += result.syncedShots;
      useOutboxStore.getState().remove(entry.round.roundId);
    } else {
      useOutboxStore.getState().recordFailure(entry.round.roundId, result.error ?? 'unknown');
      // Stop on the first failure — the rest will fail the same way, and an
      // auth problem in particular wants the user rather than more attempts.
      return { ok: false, syncedShots: synced, needsAuth: result.needsAuth, error: result.error };
    }
  }
  return { ok: true, syncedShots: synced };
}

let inFlight: Promise<SyncResult> | null = null;

/**
 * The entry point every trigger calls.
 *
 * Serialised: reconnect, app-resume and the retry timer routinely fire at once,
 * and two concurrent passes would race on the same rows and double-count what
 * they synced.
 */
export function syncAll(): Promise<SyncResult> {
  if (inFlight) return inFlight;

  inFlight = (async (): Promise<SyncResult> => {
    try {
      if (!isUsablyOnline()) {
        // Don't trust a stale reading — re-probe before giving up, since the
        // usual reason we're here is that connectivity just changed.
        const status = await refreshConnectivity();
        if (status !== 'online') return { ok: false, syncedShots: 0, error: 'offline' };
      }

      // A round can outlive an access token by hours. Refresh BEFORE writing so
      // a whole round doesn't fail one row at a time on an expired JWT.
      const { error: authErr } = await supabase.auth.refreshSession();
      if (authErr) {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          return { ok: false, syncedShots: 0, needsAuth: true, error: 'Session expired' };
        }
      }

      const outboxResult = await drainOutbox();
      const activeResult = await reconcileActiveRound();

      return {
        ok: outboxResult.ok && activeResult.ok,
        syncedShots: outboxResult.syncedShots + activeResult.syncedShots,
        needsAuth: outboxResult.needsAuth || activeResult.needsAuth,
        error: outboxResult.error ?? activeResult.error
      };
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}

/**
 * Park a finished round for upload.
 *
 * Called when finishing couldn't reach the server. The snapshot has to be taken
 * BEFORE the store is cleared, or the round is gone.
 */
export function enqueueFinishedRound(
  round: ActiveRound,
  completion: PendingRound['completion']
) {
  useOutboxStore.getState().enqueue({
    round,
    completion,
    queuedAt: new Date().toISOString(),
    attempts: 0
  });
}
