import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
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
  tempId: string;
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
  /** When set, the shot has been persisted to Supabase and has a real id. */
  remoteId?: string;
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
  holeId?: string;
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
}

interface RoundState {
  active: ActiveRound | null;
  startRound: (round: ActiveRound) => void;
  endRound: () => void;
  setCurrentHole: (idx: number) => void;
  updateHole: (holeNumber: number, patch: Partial<LocalHole>) => void;
  addShot: (holeNumber: number, shot: LocalShot) => void;
  updateShot: (holeNumber: number, tempId: string, patch: Partial<LocalShot>) => void;
  removeShot: (holeNumber: number, tempId: string) => void;
  markShotSynced: (holeNumber: number, tempId: string, remoteId: string) => void;
  applyHoleIds: (holes: RoundHole[]) => void;
  reset: () => void;
  hydrateFromRemote: (round: Round, holes: RoundHole[], shots: Shot[]) => void;
}

export const useRoundStore = create<RoundState>()(
  persist(
    (set) => ({
      active: null,

      startRound: (round) => set({ active: round }),

      endRound: () => set({ active: null }),

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

      updateShot: (holeNumber, tempId, patch) =>
        set((s) => {
          if (!s.active) return s;
          const holes = s.active.holes.map((h) =>
            h.holeNumber === holeNumber
              ? {
                  ...h,
                  shots: h.shots.map((shot) =>
                    shot.tempId === tempId ? { ...shot, ...patch } : shot
                  ),
                  dirty: true
                }
              : h
          );
          return { active: { ...s.active, holes } };
        }),

      removeShot: (holeNumber, tempId) =>
        set((s) => {
          if (!s.active) return s;
          const holes = s.active.holes.map((h) =>
            h.holeNumber === holeNumber
              ? {
                  ...h,
                  shots: h.shots
                    .filter((shot) => shot.tempId !== tempId)
                    .map((shot, idx) => ({ ...shot, shotNumber: idx + 1 })),
                  dirty: true
                }
              : h
          );
          return { active: { ...s.active, holes } };
        }),

      markShotSynced: (holeNumber, tempId, remoteId) =>
        set((s) => {
          if (!s.active) return s;
          const holes = s.active.holes.map((h) =>
            h.holeNumber === holeNumber
              ? {
                  ...h,
                  shots: h.shots.map((shot) =>
                    shot.tempId === tempId ? { ...shot, remoteId } : shot
                  )
                }
              : h
          );
          return { active: { ...s.active, holes } };
        }),

      applyHoleIds: (remoteHoles) =>
        set((s) => {
          if (!s.active) return s;
          const map = new Map(remoteHoles.map((rh) => [rh.hole_number, rh.id]));
          const holes = s.active.holes.map((h) => ({
            ...h,
            holeId: map.get(h.holeNumber) ?? h.holeId,
            dirty: false
          }));
          return { active: { ...s.active, holes } };
        }),

      reset: () => set({ active: null }),

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
              tempId: s.id,
              remoteId: s.id,
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
            currentHoleIndex: 0,
            holes: localHoles
          }
        });
      }
    }),
    {
      name: 'grt-active-round',
      partialize: (state) => ({ active: state.active })
    }
  )
);

export function emptyHoles(count: number, defaultPar = 4): LocalHole[] {
  return Array.from({ length: count }, (_, i) => ({
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
