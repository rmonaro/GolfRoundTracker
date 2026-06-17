// Watch-swing → range bridge.
//
// The watch already streams per-swing events (tempo, timing, motion quality,
// HR, club) to the phone. `usePracticeWatchSync` (mounted at the app root)
// ingests them via `practiceController` into `swingSessionStore`, regardless of
// which screen is active. This bridge taps that same store: when a new swing
// lands during a range session, it forwards a `SwingEvent` to the registered
// handler so the RangeSession screen can open the "tap where it landed" prompt
// and link the resulting range_shot to the swing.
//
// The screen still registers via `onSwing` exactly as before — the live
// subscription is wired entirely inside this module.

import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { useBagStore } from '@/stores/bagStore';

export type SwingEvent = {
  /** The swing's local id in swingSessionStore (stable key for the row). */
  id: string;
  /** Resolved club label, or null when the watch didn't supply a club. */
  club: string | null;
};

type SwingHandler = (e: SwingEvent) => void;

let handler: SwingHandler | null = null;
let unsubscribe: (() => void) | null = null;
// Swing ids we've already forwarded — keyed by id so the remoteId update that
// fires after persistence doesn't re-emit the same swing.
const emitted = new Set<string>();

function clubLabelFor(clubId: string | null): string | null {
  if (!clubId) return null;
  const c = useBagStore.getState().clubs.find((b) => b.clubId === clubId);
  return c ? c.customName || c.name : null;
}

function startSubscription(): void {
  if (unsubscribe) return;
  // Seed with the swings that already exist so we only forward NEW ones that
  // arrive after the range session begins listening.
  for (const s of useSwingSessionStore.getState().swings) emitted.add(s.id);

  unsubscribe = useSwingSessionStore.subscribe((state) => {
    if (!handler) return;
    for (const s of state.swings) {
      if (emitted.has(s.id)) continue;
      emitted.add(s.id);
      // Air/practice waggles aren't ball strikes — don't prompt a landing tap.
      if (s.isAirSwing) continue;
      handler({ id: s.id, club: clubLabelFor(s.clubId) });
    }
  });
}

/** Register the (single) handler the RangeSession screen reacts to. */
export function onSwing(cb: SwingHandler): void {
  handler = cb;
  startSubscription();
}

/** Unregister the handler and stop listening (call on screen unmount). */
export function offSwing(): void {
  handler = null;
  if (unsubscribe) {
    unsubscribe();
    unsubscribe = null;
  }
  emitted.clear();
}

/**
 * Resolve the persisted swing_metrics uuid for a forwarded SwingEvent, or null
 * if the swing hasn't persisted yet. `range_shots.swing_event_id` is a uuid
 * column, so the local (non-uuid) id must never be stored there — we link only
 * once the real row id (`remoteId`) exists.
 */
export function resolveSwingEventId(swingEventId: string): string | null {
  const swing = useSwingSessionStore.getState().swings.find((s) => s.id === swingEventId);
  return swing?.remoteId ?? null;
}

// TEMP: dev-only manual trigger so the landing-tap loop is testable in the
// browser (where there's no watch). Bypasses the store, so resolveSwingEventId
// returns null for it — the shot still links the club, just no swing row.
export function __devEmitSwing(e: SwingEvent): void {
  handler?.(e);
}
