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

    async function bootstrap() {
      const { data } = await supabase.auth.getSession();
      if (!mounted) return;
      setSession(data.session);

      if (data.session?.user) {
        try {
          let profile = await profileRepo.get(data.session.user.id);
          if (!profile) {
            const meta = (data.session.user.user_metadata ?? {}) as {
              first_name?: string;
              last_name?: string;
            };
            profile = await profileRepo.upsert({
              id: data.session.user.id,
              email: data.session.user.email ?? '',
              first_name: meta.first_name ?? null,
              last_name: meta.last_name ?? null
            });
          }
          if (mounted) setProfile(profile);
        } catch (err) {
          console.error('[auth] profile bootstrap failed', err);
        }
      }
      if (mounted) setInitializing(false);
    }

    bootstrap();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) setProfile(null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [setSession, setProfile, setInitializing]);

  return <>{children}</>;
}
