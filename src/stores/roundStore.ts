import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createIdbStorage } from '@/lib/idbStorage';
import { isUuid, newId } from '@/lib/ids';
import type {
  BagClub,
  DistanceUnit,
  FairwayResult,
  Lie,
  PenaltyType,
  Round,
  RoundHole,
  Shot,
  ShotResult,
  TargetResult,
  TargetType
} from '@/models';

export interface LocalShot {
  /**
   * Client-minted UUID, assigned at creation and never changed. This IS the
   * `shots.id` primary key — the server never assigns one. See lib/ids.ts.
   */
  id: string;
  shotNumber: number;
  clubId: string | null;
  /** Legacy single-field outcome, derived from target_type/target_result/lie. */
  shotResult: ShotResult;
  /** Structured outcome — what was being aimed at and how it ended. */
  targetType: TargetType | null;
  targetResult: TargetResult | null;
  lie: Lie | null;
  /** Optional penalty tag (OB, Water, Lost Ball, Unplayable, Wrong Ball, Bunker). */
  penaltyType: PenaltyType | null;
  distance: number | null;
  distanceUnit: DistanceUnit | null;
  notes: string | null;
  createdAt: string;
  /**
   * ISO timestamp of the last successful push to Supabase; null/undefined means
   * the server has never seen this shot.
   *
   * This replaces the old "does it have a remoteId?" test. Once ids are minted
   * on the client, having an id says nothing about whether the row exists
   * remotely — so sync state has to be tracked explicitly, or an offline shot
   * would look synced and its edits/deletes would target a row that isn't there.
   */
  syncedAt?: string | null;
  /**
   * False for auto-detected (watch impact-primary) shots awaiting the golfer's
   * review; true/undefined for manual + historical shots. Drives the per-hole
   * and round-summary verification flows. Undefined is treated as verified.
   */
  verified?: boolean;
  // V2 GPS placeholders — undefined in V1
  startLat?: number | null;
  startLng?: number | null;
  endLat?: number | null;
  endLng?: number | null;
  calculatedDistance?: number | null;
}

export interface LocalHole {
  /**
   * Client-minted UUID = `round_holes.id`. Required, and assigned before the
   * server has ever heard of the round — that's what lets a shot attach to its
   * hole offline.
   */
  holeId: string;
  /**
   * ISO timestamp of the last successful push of this hole row, or null if the
   * server has never seen it. Same reasoning as `LocalShot.syncedAt`: with
   * client-minted ids, having an id no longer implies the row exists remotely,
   * and a shot's foreign key needs its parent hole to be there first.
   */
  syncedAt?: string | null;
  holeNumber: number;
  par: number;
  yardage: number | null;
  strokes: number;
  putts: number;
  penaltyStrokes: number;
  fairwayResult: FairwayResult | null;
  sand: boolean;
  gir: boolean;
  /** Multi-select set of club ids the golfer used on this hole. */
  clubsUsed: string[];
  shots: LocalShot[];
  dirty: boolean;
  /**
   * Per-round pin position override. The course's stored `green_lng/lat` is
   * the centroid of the green; in real play the pin is moved daily within
   * the green polygon. When set these win over the course coords for the
   * flag marker, aim-line endpoint, putting bounds, and distance-to-pin
   * readings. Cleared when the round ends. Lives only in the local store
   * for now (no DB column) — the Zustand persist middleware keeps it across
   * refreshes within the device.
   */
  pinLat?: number | null;
  pinLng?: number | null;
}

export interface ActiveRound {
  roundId: string;
  userId: string;
  courseId: string | null;
  courseName: string;
  holesPlayed: number;
  courseRating: number | null;
  slopeRating: number | null;
  totalPar: number;
  totalYardage: number | null;
  startedAt: string;
  currentHoleIndex: number;
  holes: LocalHole[];
  /**
   * TournamentManagement (TM) linkage — present only when this round was started
   * from "My Tournaments". Drives the live score/shot push to TM. The round's
   * own id (`roundId`) is what we send to TM as `round_tracking_round_id`.
   */
  tmRegistrationId?: string | null;
  tmRoundNumber?: number | null;
  tmTournamentSlug?: string | null;

  /**
   * Selected tee set (migration 029). Held locally so the round snapshot is
   * COMPLETE — the reconciler recreates the `rounds` row from this alone, and a
   * field that only exists server-side would be nulled out on the next push.
   */
  teeId?: string | null;
  teeName?: string | null;

  /**
   * Scorer mode (migration 034, docs/SCORER_MODE.md). Absent on every round a
   * golfer tracks themselves.
   *
   * While tracking, `userId` is the SCOREKEEPER — they own every row they write,
   * which is what lets the reconciler run unchanged. `athleteName` and
   * `pendingAthleteEmail` say who the card is actually for.
   */
  scoringMode?: 'SELF' | 'MARKER';
  /** The scorekeeper's user id. Equals `userId` until the card is transferred. */
  scoredByUserId?: string | null;
  /** Athlete this card belongs to, for the player tabs. */
  athleteName?: string | null;
  /** Claim key: set when the athlete has no GRT account yet. */
  pendingAthleteEmail?: string | null;
  /** TM tee group this round is being scored under. */
  teeGroupId?: string | null;
  /**
   * The ATHLETE's bag, so the scorer records the club that player actually
   * carries — with that player's own typical carry distances, which is what
   * lets a tapped shot distance suggest a club.
   *
   * Snapshotted onto the round rather than fetched on demand because scoring
   * has to work with no signal, and a live query would leave the club picker
   * empty in a dead zone. Falls back to the standard club catalog (no
   * distances) for a player with no GRT account or an empty bag.
   */
  athleteBag?: BagClub[];

  // --- sync bookkeeping (Phase 5) ---

  /**
   * ISO timestamp of the last successful push of the `rounds` row, or null if
   * the server has never seen it. The RLS policies on `round_holes` and `shots`
   * both require the parent round to exist, so this gates everything else —
   * holes and shots cannot land before the round does.
   */
  roundSyncedAt?: string | null;
  /**
   * Ids of shots deleted locally that MAY still exist on the server.
   *
   * A reconciler compares local state to remote and pushes the difference, which
   * expresses creates and updates fine but cannot express "this used to exist".
   * Without tombstones, a shot deleted offline would simply reappear on the next
   * sync. Cleared once the delete has been confirmed remotely.
   */
  deletedShotIds?: string[];
}

interface RoundState {
  active: ActiveRound | null;
  /**
   * Other live rounds, parked while a different one is on screen. Keyed by
   * roundId. **Empty for every flow except scorer mode** (docs/SCORER_MODE.md),
   * where one scorekeeper tracks 2-4 players at once.
   *
   * Deliberately a sibling of `active` rather than `active` becoming an array:
   * every mutator below keeps operating on `active` exactly as it did, so a
   * golfer tracking their own round runs the same code as before, and the
   * persisted payload for a single round is unchanged — no version bump, and
   * nothing to migrate on a phone that updates mid-round.
   */
  parked: Record<string, ActiveRound>;
  startRound: (round: ActiveRound) => void;
  endRound: () => void;
  /** Add a live round WITHOUT displacing the one on screen. Scorer mode only. */
  addParallelRound: (round: ActiveRound) => void;
  /** Put `roundId` on screen and park whatever was there. */
  switchRound: (roundId: string) => void;
  /**
   * Drop a live round. When it's the one on screen another parked round takes
   * its place, so a scorer who finishes one player stays inside the group.
   */
  closeRound: (roundId: string) => void;
  setCurrentHole: (idx: number) => void;
  updateHole: (holeNumber: number, patch: Partial<LocalHole>) => void;
  addShot: (holeNumber: number, shot: LocalShot) => void;
  /** Move the shot with `id` to array position `toIndex` (0-based) and
   *  renumber the hole. Backs the shots-list reorder controls. */
  moveShot: (holeNumber: number, id: string, toIndex: number) => void;
  updateShot: (holeNumber: number, id: string, patch: Partial<LocalShot>) => void;
  removeShot: (holeNumber: number, id: string) => void;
  /** Stamp a shot as present on the server. Id is unchanged — it never moves. */
  markShotSynced: (holeNumber: number, id: string) => void;
  applyHoleIds: (holes: RoundHole[]) => void;
  reset: () => void;
  hydrateFromRemote: (round: Round, holes: RoundHole[], shots: Shot[]) => void;

  // --- sync bookkeeping (Phase 5) ---
  //
  // These three take an OPTIONAL roundId. Omitted (every pre-scorer-mode call
  // site) it means the round on screen, exactly as before. The reconciler
  // passes it explicitly so it can stamp a parked round it just pushed.

  /** Record that the `rounds` row now exists remotely. */
  markRoundSynced: (roundId?: string) => void;
  /**
   * Remember a deleted shot so the reconciler can delete it remotely too.
   * A no-op for a shot the server never saw — there's nothing to tombstone.
   */
  recordShotDeletion: (shotId: string, wasSynced: boolean) => void;
  /** Drop tombstones whose remote deletes have been confirmed. */
  clearShotTombstones: (shotIds: string[], roundId?: string) => void;
  /** Bulk-stamp shots and holes as synced after a successful reconcile. */
  markSynced: (holeIds: string[], shotIds: string[], roundId?: string) => void;
}

/**
 * Apply `fn` to one live round — the one on screen by default, or a parked one
 * when `roundId` names it. Returns the state unchanged when there's no such
 * round, so a stamp arriving for a round that was just closed is a no-op rather
 * than a crash.
 */
function applyToRound(
  s: RoundState,
  roundId: string | undefined,
  fn: (round: ActiveRound) => ActiveRound
): RoundState | Pick<RoundState, 'active'> | Pick<RoundState, 'parked'> {
  if (!roundId || s.active?.roundId === roundId) {
    return s.active ? { active: fn(s.active) } : s;
  }
  const parked = s.parked[roundId];
  if (!parked) return s;
  return { parked: { ...s.parked, [roundId]: fn(parked) } };
}

/**
 * Every round currently being tracked — the one on screen plus any parked.
 *
 * Builds a new array per call, so read it imperatively (`getState()`) from the
 * reconciler rather than using it as a component selector, which would re-render
 * on every store write.
 */
export function liveRounds(s: RoundState): ActiveRound[] {
  return s.active ? [s.active, ...Object.values(s.parked)] : Object.values(s.parked);
}

/** v1 = client-minted UUIDs (`id` + `syncedAt`) replacing `tempId`/`remoteId`. */
export const PERSIST_VERSION = 1;

/**
 * Bring a round persisted by an older build up to the current shape.
 *
 * This runs on devices mid-round at update time, so getting it wrong loses
 * somebody's afternoon. Two things must happen:
 *
 *   • `tempId` → `id`. A synced shot already has a server UUID in `remoteId`
 *     and MUST keep it, or later writes would target a row that doesn't exist
 *     and duplicate it instead. An unsynced shot's `tmp_…` id is not a UUID and
 *     Postgres would reject it, so it gets freshly minted.
 *   • `remoteId` presence → `syncedAt`. We don't know the real sync time, so we
 *     use the shot's creation time — it only has to be non-null.
 *
 * Holes with no `holeId` (never persisted) get one minted, so shots can attach
 * offline without waiting for the server to name their parent.
 */
export function migratePersistedRound(
  persisted: unknown,
  version: number
): { active: ActiveRound | null; parked?: Record<string, ActiveRound> } {
  const state = (persisted ?? {}) as {
    active: ActiveRound | null;
    parked?: Record<string, ActiveRound>;
  };
  if (version >= PERSIST_VERSION || !state.active) return state;

  type LegacyShot = LocalShot & { tempId?: string; remoteId?: string };

  const holes = (state.active.holes ?? []).map((h) => ({
    ...h,
    holeId: h.holeId ?? newId(),
    shots: (h.shots ?? []).map((raw) => {
      const legacy = raw as LegacyShot;
      const serverId = legacy.remoteId;
      const legacyId = legacy.tempId ?? legacy.id;
      const { tempId: _t, remoteId: _r, ...rest } = legacy;
      return {
        ...rest,
        // Keep the server's id when there is one; otherwise mint a real UUID
        // (a `tmp_…` string would be rejected by the uuid column).
        id: serverId ?? (isUuid(legacyId) ? legacyId : newId()),
        syncedAt: serverId ? (legacy.createdAt ?? new Date().toISOString()) : null
      } as LocalShot;
    })
  }));

  // Spread `state` so anything else persisted (notably `parked`) survives a
  // future version bump instead of being silently dropped by this rebuild.
  return { ...state, active: { ...state.active, holes } };
}

export const useRoundStore = create<RoundState>()(
  persist(
    (set) => ({
      active: null,
      parked: {},

      startRound: (round) => set({ active: round }),

      // Clears only what's on screen. A scorer finishing one player uses
      // closeRound instead, which keeps the rest of the group alive.
      endRound: () => set({ active: null }),

      addParallelRound: (round) =>
        set((s) => {
          if (s.active?.roundId === round.roundId) return s;
          return { parked: { ...s.parked, [round.roundId]: round } };
        }),

      switchRound: (roundId) =>
        set((s) => {
          if (s.active?.roundId === roundId) return s;
          const target = s.parked[roundId];
          if (!target) return s;
          const parked = { ...s.parked };
          delete parked[roundId];
          if (s.active) parked[s.active.roundId] = s.active;
          return { active: target, parked };
        }),

      closeRound: (roundId) =>
        set((s) => {
          if (s.active?.roundId === roundId) {
            // Promote a parked round so the scorer lands on the next player
            // rather than on an empty screen.
            const parked = { ...s.parked };
            const nextId = Object.keys(parked)[0];
            if (!nextId) return { active: null, parked };
            const next = parked[nextId];
            delete parked[nextId];
            return { active: next, parked };
          }
          if (!s.parked[roundId]) return s;
          const parked = { ...s.parked };
          delete parked[roundId];
          return { parked };
        }),

      setCurrentHole: (idx) =>
        set((s) => (s.active ? { active: { ...s.active, currentHoleIndex: idx } } : s)),

      updateHole: (holeNumber, patch) =>
        set((s) => {
          if (!s.active) return s;
          const holes = s.active.holes.map((h) =>
            h.holeNumber === holeNumber ? { ...h, ...patch, dirty: true } : h
          );
          return { active: { ...s.active, holes } };
        }),

      addShot: (holeNumber, shot) =>
        set((s) => {
          if (!s.active) return s;
          const holes = s.active.holes.map((h) =>
            h.holeNumber === holeNumber
              ? { ...h, shots: [...h.shots, shot], dirty: true }
              : h
          );
          return { active: { ...s.active, holes } };
        }),

      moveShot: (holeNumber, id, toIndex) =>
        set((s) => {
          if (!s.active) return s;
          const holes = s.active.holes.map((h) => {
            if (h.holeNumber !== holeNumber) return h;
            const from = h.shots.findIndex((sh) => sh.id === id);
            if (from < 0) return h;
            const next = [...h.shots];
            const [moved] = next.splice(from, 1);
            const at = Math.max(0, Math.min(toIndex, next.length));
            next.splice(at, 0, moved);
            return {
              ...h,
              shots: next.map((sh, idx) => ({ ...sh, shotNumber: idx + 1 })),
              dirty: true
            };
          });
          return { active: { ...s.active, holes } };
        }),

      updateShot: (holeNumber, id, patch) =>
        set((s) => {
          if (!s.active) return s;
          const holes = s.active.holes.map((h) =>
            h.holeNumber === holeNumber
              ? {
                  ...h,
                  shots: h.shots.map((shot) =>
                    shot.id === id ? { ...shot, ...patch } : shot
                  ),
                  dirty: true
                }
              : h
          );
          return { active: { ...s.active, holes } };
        }),

      removeShot: (holeNumber, id) =>
        set((s) => {
          if (!s.active) return s;
          const holes = s.active.holes.map((h) =>
            h.holeNumber === holeNumber
              ? {
                  ...h,
                  shots: h.shots
                    .filter((shot) => shot.id !== id)
                    .map((shot, idx) => ({ ...shot, shotNumber: idx + 1 })),
                  dirty: true
                }
              : h
          );
          return { active: { ...s.active, holes } };
        }),

      markShotSynced: (holeNumber, id) =>
        set((s) => {
          if (!s.active) return s;
          const now = new Date().toISOString();
          const holes = s.active.holes.map((h) =>
            h.holeNumber === holeNumber
              ? {
                  ...h,
                  shots: h.shots.map((shot) =>
                    shot.id === id ? { ...shot, syncedAt: now } : shot
                  )
                }
              : h
          );
          return { active: { ...s.active, holes } };
        }),

      markRoundSynced: (roundId) =>
        set((s) =>
          applyToRound(s, roundId, (r) => ({
            ...r,
            roundSyncedAt: new Date().toISOString()
          }))
        ),

      recordShotDeletion: (shotId, wasSynced) =>
        set((s) => {
          // Never synced ⇒ no remote row ⇒ nothing to tombstone.
          if (!s.active || !wasSynced) return s;
          const existing = s.active.deletedShotIds ?? [];
          if (existing.includes(shotId)) return s;
          return { active: { ...s.active, deletedShotIds: [...existing, shotId] } };
        }),

      clearShotTombstones: (shotIds, roundId) =>
        set((s) => {
          const done = new Set(shotIds);
          return applyToRound(s, roundId, (r) => ({
            ...r,
            deletedShotIds: (r.deletedShotIds ?? []).filter((id) => !done.has(id))
          }));
        }),

      markSynced: (holeIds, shotIds, roundId) =>
        set((s) => {
          const now = new Date().toISOString();
          const holeSet = new Set(holeIds);
          const shotSet = new Set(shotIds);
          return applyToRound(s, roundId, (r) => ({
            ...r,
            holes: r.holes.map((h) => {
              const holeHit = holeSet.has(h.holeId);
              const shots = h.shots.map((sh) =>
                shotSet.has(sh.id) ? { ...sh, syncedAt: now } : sh
              );
              if (!holeHit && shots === h.shots) return h;
              return {
                ...h,
                shots,
                ...(holeHit ? { syncedAt: now, dirty: false } : {})
              };
            })
          }));
        }),

      applyHoleIds: (remoteHoles) =>
        set((s) => {
          if (!s.active) return s;
          const map = new Map(remoteHoles.map((rh) => [rh.hole_number, rh.id]));
          const now = new Date().toISOString();
          const holes = s.active.holes.map((h) => {
            const remoteId = map.get(h.holeNumber);
            if (remoteId == null) return h;
            return {
              ...h,
              // Normally identical to what we sent (the server echoes our id);
              // differs only for a legacy round whose rows predate client ids.
              holeId: remoteId,
              // Confirmed present on the server — shots may now reference it.
              syncedAt: now,
              dirty: false
            };
          });
          return { active: { ...s.active, holes } };
        }),

      reset: () => set({ active: null, parked: {} }),

      hydrateFromRemote: (round, holes, shots) => {
        const holeById = new Map(holes.map((h) => [h.id, h]));
        const shotsByHole = new Map<string, Shot[]>();
        for (const shot of shots) {
          const arr = shotsByHole.get(shot.hole_id) ?? [];
          arr.push(shot);
          shotsByHole.set(shot.hole_id, arr);
        }
        const localHoles: LocalHole[] = holes.map((h) => {
          const hShots = (shotsByHole.get(h.id) ?? []).sort((a, b) => a.shot_number - b.shot_number);
          return {
            holeId: h.id,
            holeNumber: h.hole_number,
            par: h.par,
            yardage: h.yardage,
            strokes: h.strokes,
            putts: h.putts,
            penaltyStrokes: h.penalty_strokes,
            fairwayResult: h.fairway_result,
            sand: h.sand,
            gir: h.gir,
            clubsUsed: h.clubs_used ?? [],
            shots: hShots.map((s) => ({
              // Came from the server, so it's synced by definition.
              id: s.id,
              syncedAt: s.created_at,
              shotNumber: s.shot_number,
              clubId: s.club_id,
              shotResult: s.shot_result,
              targetType: s.target_type,
              targetResult: s.target_result,
              lie: s.lie,
              penaltyType: s.penalty_type,
              distance: s.distance,
              distanceUnit: s.distance_unit,
              notes: s.notes,
              createdAt: s.created_at,
              verified: s.verified ?? true,
              startLat: s.start_lat,
              startLng: s.start_lng,
              endLat: s.end_lat,
              endLng: s.end_lng,
              calculatedDistance: s.calculated_distance
            })),
            dirty: false
          };
        });
        // Pad in any missing holes (in case the round was created with 18 but data only persisted partially)
        for (let i = 1; i <= round.holes_played; i++) {
          if (!localHoles.find((lh) => lh.holeNumber === i)) {
            localHoles.push({
              // No server row for this hole yet — mint one now so shots can
              // attach to it, and let the next upsert create it.
              holeId: newId(),
              holeNumber: i,
              par: 4,
              yardage: null,
              strokes: 0,
              putts: 0,
              penaltyStrokes: 0,
              fairwayResult: null,
              sand: false,
              gir: false,
              clubsUsed: [],
              shots: [],
              dirty: false
            });
          }
        }
        localHoles.sort((a, b) => a.holeNumber - b.holeNumber);
        void holeById; // currently unused but keeps mapping clear

        // Resume at the first unplayed hole (no shots + no strokes) so a resumed
        // round opens where the player left off — not back at hole 1 — and the
        // earlier holes count as "completed" for running totals. Falls back to
        // the last hole when every hole has data.
        const firstUnplayed = localHoles.findIndex(
          (h) => h.shots.length === 0 && (h.strokes ?? 0) === 0
        );
        const resumeIndex =
          firstUnplayed === -1 ? Math.max(0, localHoles.length - 1) : firstUnplayed;

        set({
          active: {
            roundId: round.id,
            userId: round.user_id,
            courseId: round.course_id,
            courseName: round.course_name,
            holesPlayed: round.holes_played,
            courseRating: round.course_rating,
            slopeRating: round.slope_rating,
            totalPar: round.par,
            totalYardage: null,
            startedAt: round.started_at,
            currentHoleIndex: resumeIndex,
            holes: localHoles,
            tmRegistrationId: round.tm_registration_id ?? null,
            tmRoundNumber: round.tm_round_number ?? null,
            tmTournamentSlug: round.tm_tournament_slug ?? null
          }
        });
      }
    }),
    {
      name: 'grt-active-round',
      // IndexedDB, not localStorage: an in-progress round is unsynced data and
      // must survive storage pressure. Existing localStorage rounds are lifted
      // across automatically on first read (see createIdbStorage).
      storage: createJSONStorage(() => createIdbStorage('grt-active-round')),
      // `parked` is persisted too: a scorer's other 1-3 players are unsynced
      // data exactly like the one on screen, and must survive an app restart
      // mid-round. A payload written before scorer mode simply has no `parked`
      // key, and zustand's shallow merge leaves the initial {} in place — which
      // is why this needed no version bump.
      partialize: (state) => ({ active: state.active, parked: state.parked }),
      version: PERSIST_VERSION,
      migrate: migratePersistedRound
    }
  )
);

export function emptyHoles(count: number, defaultPar = 4): LocalHole[] {
  return Array.from({ length: count }, (_, i) => ({
    // Minted up front so a shot can attach to its hole with no connectivity.
    // Previously this arrived from the server via applyHoleIds, which is why
    // recording a shot offline used to be impossible.
    holeId: newId(),
    holeNumber: i + 1,
    par: defaultPar,
    yardage: null,
    strokes: 0,
    putts: 0,
    penaltyStrokes: 0,
    fairwayResult: null,
    sand: false,
    gir: false,
    clubsUsed: [],
    shots: [],
    dirty: false
  }));
}
