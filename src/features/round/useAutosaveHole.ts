import { useEffect, useRef } from 'react';
import { roundRepo } from '@/services/roundRepo';
import { useRoundStore, type LocalHole } from '@/stores/roundStore';

/**
 * Debounced autosave of the currently-edited hole to Supabase.
 * Avoid hammering the DB while a golfer holds + on the stroke stepper.
 */
export function useAutosaveHole(holeNumber: number, delayMs = 400) {
  const hole = useRoundStore((s) => s.active?.holes.find((h) => h.holeNumber === holeNumber));
  const roundId = useRoundStore((s) => s.active?.roundId);
  const applyHoleIds = useRoundStore((s) => s.applyHoleIds);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!hole || !roundId || !hole.dirty) return;

    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try {
        const saved = await roundRepo.upsertHole(toPayload(roundId, hole));
        applyHoleIds([saved]);
      } catch (err) {
        console.error('[autosave] hole failed', err);
      }
    }, delayMs);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [hole, roundId, applyHoleIds, delayMs]);
}

function toPayload(roundId: string, hole: LocalHole) {
  return {
    id: hole.holeId,
    round_id: roundId,
    hole_number: hole.holeNumber,
    par: hole.par,
    yardage: hole.yardage,
    strokes: hole.strokes,
    putts: hole.putts,
    penalty_strokes: hole.penaltyStrokes,
    fairway_result: hole.fairwayResult,
    sand: hole.sand,
    gir: hole.gir,
    clubs_used: hole.clubsUsed
  };
}
