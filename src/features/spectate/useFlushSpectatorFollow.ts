// Redeems a code the viewer asked to keep, once they have an account to keep it
// on.
//
// The gap this closes: a spectator taps "create an account" on the way out of a
// round, and then disappears into the sign-up form, possibly an email
// confirmation, and the app's own landing screens. By the time a session
// exists, whatever screen knew about the code is long gone. So the code is
// parked in `spectatorStore.pendingFollowCode` (persisted) and redeemed from
// here — mounted at the app root, so it fires wherever they land.

import { useEffect, useRef } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useSpectatorStore } from '@/stores/spectatorStore';
import { spectatorRepo } from '@/services/spectatorRepo';

export function useFlushSpectatorFollow(): void {
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const pending = useSpectatorStore((s) => s.pendingFollowCode);
  const setPendingFollow = useSpectatorStore((s) => s.setPendingFollow);
  // One attempt per code per session. Without it a re-render between the RPC
  // starting and the store clearing would fire a second one.
  const attempted = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || !pending) return;
    if (attempted.current === pending) return;
    attempted.current = pending;

    spectatorRepo
      .follow(pending)
      .then(() => setPendingFollow(null))
      .catch((err) => {
        // Clear it anyway. The common failure is the athlete having revoked the
        // code in the meantime, and a dead code retried on every launch forever
        // is worse than a follow the viewer can recreate by asking for a new
        // one. Nothing is shown: they are mid-onboarding somewhere and this was
        // never a foreground task.
        console.warn('[spectate] could not save the pending follow', err);
        setPendingFollow(null);
      });
  }, [userId, pending, setPendingFollow]);
}
