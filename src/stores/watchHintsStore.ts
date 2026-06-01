import { create } from 'zustand';

interface WatchHintsState {
  /** Phone's currently-selected club id (mirrors HoleTrackingPage.defaultClubId). */
  selectedClubId: string | null;
  /** True while the phone has a pending landing point or open shot sheet. */
  recordingShot: boolean;
  setSelectedClubId: (id: string | null) => void;
  setRecordingShot: (recording: boolean) => void;
}

/**
 * Tiny shared slot for state that lives in HoleTrackingPage but needs to
 * flow into the watch snapshot from useWatchSync at the app root. Keeping
 * it in a dedicated store (rather than the larger roundStore) makes it
 * clear this is purely UI-mirror state — not anything the rest of the app
 * needs to persist or react to.
 */
export const useWatchHintsStore = create<WatchHintsState>((set) => ({
  selectedClubId: null,
  recordingShot: false,
  setSelectedClubId: (id) => set({ selectedClubId: id }),
  setRecordingShot: (recording) => set({ recordingShot: recording })
}));
