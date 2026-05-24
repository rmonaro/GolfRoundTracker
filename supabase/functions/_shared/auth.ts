import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

/**
 * Build a Supabase client that acts AS the caller (RLS enforced).
 * Pulls the bearer token from the request's Authorization header.
 */
export function callerClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization') ?? '';
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/**
 * Build a Supabase client that uses the service role key — RLS bypassed.
 * Use this only for writes that should not be constrained by the caller's permissions.
 */
export function serviceClient(): SupabaseClient {
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

export interface AuthResult {
  userId: string;
  isAdmin: boolean;
}

/**
 * Resolve the caller's auth state, including whether they're an admin.
 * Throws an Error with `status` set when the request is unauthenticated.
 */
export async function resolveAuth(req: Request): Promise<AuthResult> {
  const supabase = callerClient(req);
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData.user) {
    const err = new Error('Not authenticated');
    (err as Error & { status: number }).status = 401;
    throw err;
  }
  const userId = userData.user.id;
  // is_admin() is a SECURITY DEFINER helper installed by migration 007.
  const { data: isAdminData, error: adminErr } = await supabase.rpc('is_admin', {
    uid: userId
  });
  if (adminErr) {
    console.error('[auth] is_admin rpc failed', adminErr);
    return { userId, isAdmin: false };
  }
  return { userId, isAdmin: Boolean(isAdminData) };
}

/** Reject the caller unless `isAdmin` is true. */
export function requireAdmin(auth: AuthResult): void {
  if (!auth.isAdmin) {
    const err = new Error('Admin only');
    (err as Error & { status: number }).status = 403;
    throw err;
  }
}
