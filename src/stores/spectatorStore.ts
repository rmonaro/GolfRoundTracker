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
  /**
   * A code the viewer asked to keep, before they had an account to keep it on.
   *
   * Set when they choose "create an account" on the way out, and redeemed by
   * `useFlushSpectatorFollow` the moment a session exists. It has to survive
   * the whole detour — sign-up form, email confirmation, the app's own landing
   * screens — which is why it lives here and not in a route param.
   */
  pendingFollowCode: string | null;
  join: (code: string, athleteName: string) => void;
  selectRound: (roundId: string | null) => void;
  setPendingFollow: (code: string | null) => void;
  leave: () => void;
}

export const useSpectatorStore = create<SpectatorState>()(
  persist(
    (set) => ({
      code: null,
      athleteName: null,
      roundId: null,
      pendingFollowCode: null,
      join: (code, athleteName) => set({ code, athleteName, roundId: null }),
      selectRound: (roundId) => set({ roundId }),
      setPendingFollow: (pendingFollowCode) => set({ pendingFollowCode }),
      // Leaves `pendingFollowCode` alone on purpose: "stop watching now" and
      // "save this athlete to the account I am about to make" are both true at
      // once on the way out.
      leave: () => set({ code: null, athleteName: null, roundId: null })
    }),
    {
      name: 'grt-spectator',
      storage: createJSONStorage(() => localStorage)
    }
  )
);
