import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

export interface AdminRole {
  isAdmin: boolean;
  isSuperAdmin: boolean;
}

const QUERY_KEY = 'profile-admin-role';

/**
 * One query definition, three views of it.
 *
 * `useIsAdmin` and `useIsSuperAdmin` share this key, so both on one screen still
 * make a single request — `select` only narrows what each caller re-renders on.
 *
 * RLS is what makes this safe to trust: the trigger from migration 042 refuses
 * any authenticated write to `is_admin` that doesn't come from a super admin,
 * and `is_super_admin` can only be set by the service role.
 *
 * `isAdmin` is derived as `is_admin OR is_super_admin`, matching the SQL
 * `public.is_admin()` helper exactly. A super admin IS an admin, and a row that
 * somehow carried only `is_super_admin` must not lock its owner out of a panel
 * every server-side policy would happily let them into.
 */
function useAdminRoleQuery() {
  const session = useAuthStore((s) => s.session);
  return {
    queryKey: [QUERY_KEY, session?.user.id],
    enabled: !!session?.user.id,
    staleTime: 1000 * 60 * 5,
    queryFn: async (): Promise<AdminRole> => {
      const { data, error } = await supabase
        .from('profiles')
        .select('is_admin, is_super_admin')
        .eq('id', session!.user.id)
        .maybeSingle();
      // A failed read must not read as "you're an admin".
      if (error) return { isAdmin: false, isSuperAdmin: false };
      const isSuperAdmin = Boolean(data?.is_super_admin);
      return { isAdmin: Boolean(data?.is_admin) || isSuperAdmin, isSuperAdmin };
    }
  };
}

export function useIsAdmin() {
  return useQuery({ ...useAdminRoleQuery(), select: (r: AdminRole) => r.isAdmin });
}

/** Only a super admin may grant or revoke admin access. */
export function useIsSuperAdmin() {
  return useQuery({ ...useAdminRoleQuery(), select: (r: AdminRole) => r.isSuperAdmin });
}
