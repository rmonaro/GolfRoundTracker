// Shared helpers for the start-a-round screens (course picker → setup, and the
// manual-entry form). Pure, so they can be unit-tested without a DOM.

import type { CourseTee } from '@/models';

/** YYYY-MM-DD in the user's local timezone — what `<input type="date">` wants. */
export function toLocalDateInput(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Convert a date-input string (YYYY-MM-DD, local) to an ISO timestamp anchored
 * at noon local time. Noon is safe: it can't drift to the wrong calendar day in
 * any UTC offset (max swing is ±14h, so 12:00 local stays inside the day in UTC
 * even for Pacific/Kiritimati and Pacific/Pago_Pago). Null for empty input.
 */
export function localDateInputToIso(s: string): string | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

export function numberOrNull(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function integerOrNull(s: string): number | null {
  if (s.trim() === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n) : null;
}

/**
 * A sensible default tee: a "White"/"Regular"-named men's set when there is
 * one, otherwise the middle of the list — a mid-length tee rather than the
 * championship or forward extreme.
 */
export function defaultTee(tees: CourseTee[]): CourseTee {
  const named = tees.find((t) => /white|regular/i.test(t.tee_name) && t.gender !== 'female');
  if (named) return named;
  return tees[Math.floor(tees.length / 2)] ?? tees[0];
}

/** A tee's per-hole detail as `{ [holeNumber]: yardage }` (index 0 = hole 1). */
export function teeHoleYardages(tee: CourseTee): Record<number, number> {
  const out: Record<number, number> = {};
  (tee.holes ?? []).forEach((h, i) => {
    if (h?.yardage != null) out[i + 1] = h.yardage;
  });
  return out;
}
