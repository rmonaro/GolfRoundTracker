// The spectator's "session", such as it is: a code and who it belongs to.
//
// localStorage rather than the IndexedDB storage the round stores use. There is
// nothing here that can't be recreated by retyping the code, and a grandparent
// who closes the app between rounds should find it still following the same
// athlete when they come back.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

interface SpectatorState {
  /** Bare eight characters, no grouping dash. Null when not watching anyone. */
  code: string | null;
  athleteName: string | null;
  /** Round the viewer last chose. Null means "whatever is newest", which is
   *  what you want during a tournament — it follows them onto the next round. */
  roundId: string | null;
  join: (code: string, athleteName: string) => void;
  selectRound: (roundId: string | null) => void;
  leave: () => void;
}

export const useSpectatorStore = create<SpectatorState>()(
  persist(
    (set) => ({
      code: null,
      athleteName: null,
      roundId: null,
      join: (code, athleteName) => set({ code, athleteName, roundId: null }),
      selectRound: (roundId) => set({ roundId }),
      leave: () => set({ code: null, athleteName: null, roundId: null })
    }),
    {
      name: 'grt-spectator',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
