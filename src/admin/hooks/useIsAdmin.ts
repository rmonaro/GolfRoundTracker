import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

/**
 * Reads profiles.is_admin for the current user via TanStack Query. RLS prevents
 * users from spoofing this value — the trigger added in migration 007 blocks
 * any self-promotion attempt. The query is cached for 5 min to avoid hitting
 * the DB on every navigation.
 */
export function useIsAdmin() {
  const session = useAuthStore((s) => s.session);
  return useQuery({
    queryKey: ['profile-is-admin', session?.user.id],
    enabled: !!session?.user.id,
    staleTime: 1000 * 60 * 5,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', session!.user.id)
        .maybeSingle();
      if (error) return false;
      return Boolean(data?.is_admin);
    }
  });
}
