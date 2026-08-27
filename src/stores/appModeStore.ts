import { create } from 'zustand';

/**
 * Which half of the app the user is in.
 *
 * - `tournament` — competitive play: their TM events, scoring for others.
 * - `rounds` — everything else: casual rounds, stats, bag, practice, range.
 */
export type AppMode = 'tournament' | 'rounds';

interface AppModeState {
  mode: AppMode | null;
  setMode: (m: AppMode) => void;
  clearMode: () => void;
}

/**
 * Deliberately NOT persisted. A player picks a side on every cold start, so the
 * app never guesses wrong after a tournament ends (or begins) between launches.
 * A page refresh on web is a cold start too, which is the intent.
 *
 * `null` means "not chosen yet" — AuthGuard sends that to /choose, which either
 * shows the two options or resolves the mode on its own (no tournaments → rounds).
 */
export const useAppModeStore = create<AppModeState>((set) => ({
  mode: null,
  setMode: (mode) => set({ mode }),
  clearMode: () => set({ mode: null })
}));

/** Landing route for a mode — the root each side's bottom nav starts on. */
export const homePathFor = (mode: AppMode): string =>
  mode === 'tournament' ? '/tournaments' : '/';
