import { supabase } from '@/lib/supabase';
import { toAppError } from '@/services/errors';
import type { TmTournamentEntry } from './types';

export interface TmLinkRow {
  id: string;
  user_id: string;
  registration_id: string;
  tournament_id: string | null;
  tournament_slug: string | null;
  tournament_name: string | null;
  registration_status: string | null;
  external_course_id: string | null;
  division_name: string | null;
  /** Last entitlements snapshot for this registration (a TmTournamentEntry). */
  snapshot: TmTournamentEntry | null;
  linked_at: string;
  updated_at: string;
}

// Read-only access to the locally-persisted TM links. The edge function writes
// these (service role) on link / entitlements; the client reads them so "My
// Tournaments" can render instantly from cache while a fresh fetch runs.
export const tmLinksRepo = {
  async listForUser(userId: string): Promise<TmLinkRow[]> {
    const { data, error } = await supabase
      .from('tm_links')
      .select('*')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load tournament links');
    return (data ?? []) as TmLinkRow[];
  },

  /** Single link by TM registration id — used to label an active tournament round. */
  async getByRegistration(userId: string, registrationId: string): Promise<TmLinkRow | null> {
    const { data, error } = await supabase
      .from('tm_links')
      .select('*')
      .eq('user_id', userId)
      .eq('registration_id', registrationId)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load tournament link');
    return (data ?? null) as TmLinkRow | null;
  }
};
