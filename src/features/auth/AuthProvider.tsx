import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { supabase } from '@/lib/supabase';
import { profileRepo } from '@/services/profileRepo';

export function AuthProvider({ children }: { children: ReactNode }) {
  const setSession = useAuthStore((s) => s.setSession);
  const setProfile = useAuthStore((s) => s.setProfile);
  const setInitializing = useAuthStore((s) => s.setInitializing);

  useEffect(() => {
    let mounted = true;

    // Load existing profile or create a fresh one from the auth user's
    // metadata. New rows get onboarded_at = null (DB default) so the
    // AuthGuard sees the user as needing onboarding.
    async function ensureProfile(session: import('@supabase/supabase-js').Session) {
      try {
        let profile = await profileRepo.get(session.user.id);
        if (!profile) {
          const meta = (session.user.user_metadata ?? {}) as {
            first_name?: string;
            last_name?: string;
          };
          profile = await profileRepo.upsert({
            id: session.user.id,
            email: session.user.email ?? '',
            first_name: meta.first_name ?? null,
            last_name: meta.last_name ?? null
          });
        }
        if (mounted) setProfile(profile);
      } catch (err) {
        console.error('[auth] profile load/create failed', err);
      }
    }

    async function bootstrap() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      if (data.session?.user) await ensureProfile(data.session);
      if (mounted) setInitializing(false);
    }

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) {
        setProfile(null);
        return;
      }
      // New session — could be sign-in or just-completed sign-up. The
      // bootstrap path above only runs once on mount, so a sign-up
      // (which fires SIGNED_IN AFTER mount) would otherwise leave
      // `profile` null forever and skip the AuthGuard's onboarding
      // redirect. Re-ensure the row here.
      void ensureProfile(session);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [setSession, setProfile, setInitializing]);

  return <>{children}</>;
}
