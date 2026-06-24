import { create } from 'zustand';

/** Brief post-save overview shown on the watch after a GPS auto-recorded shot. */
export interface WatchShotSummary {
  id: number;
  clubName: string;
  result: string;
  distanceText: string;
}

interface WatchHintsState {
  /** Phone's currently-selected club id (mirrors HoleTrackingPage.defaultClubId). */
  selectedClubId: string | null;
  /** True while the phone has a pending landing point or open shot sheet. */
  recordingShot: boolean;
  /** Whether the user is within the at-course range (mirrors the 2km gate). Null
   *  until known — the watch treats null as at-course (doesn't block). */
  atCourse: boolean | null;
  /** Current phone auto-track state, mirrored to the watch toggle. */
  autoTracking: boolean;
  /** Latest auto-recorded shot summary for the watch overview (id increments). */
  lastShotSummary: WatchShotSummary | null;
  setSelectedClubId: (id: string | null) => void;
  setRecordingShot: (recording: boolean) => void;
  setAtCourse: (atCourse: boolean | null) => void;
  setAutoTracking: (on: boolean) => void;
  setLastShotSummary: (summary: WatchShotSummary | null) => void;
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
  atCourse: null,
  autoTracking: false,
  lastShotSummary: null,
  setSelectedClubId: (id) => set({ selectedClubId: id }),
  setRecordingShot: (recording) => set({ recordingShot: recording }),
  setAtCourse: (atCourse) => set({ atCourse }),
  setAutoTracking: (on) => set({ autoTracking: on }),
  setLastShotSummary: (summary) => set({ lastShotSummary: summary })
}));
