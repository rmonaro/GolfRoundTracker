import { create } from 'zustand';

/** The drill + setup choices, handed from the setup sheet to the runner. */
export interface DrillSelection {
  drillId: string;
  config: Record<string, unknown>;
}

interface DrillRunState {
  selection: DrillSelection | null;
  setSelection: (s: DrillSelection | null) => void;
}

// Mirrors swingSessionStore's role: a tiny handoff between the setup screen and
// the runner. The run itself is persisted as a range_session (drill metadata),
// so the report reads from the DB — this store holds only the pending selection.
export const useDrillRunStore = create<DrillRunState>((set) => ({
  selection: null,
  setSelection: (selection) => set({ selection })
}));
