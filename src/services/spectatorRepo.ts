// Athlete side of spectator sharing: mint a code, see it, revoke it.
//
// The spectator side never touches this file — it has no Supabase session at
// all and goes through the `spectator-api` edge function instead. See
// `spectatorFeed.ts`.

import { supabase } from '@/lib/supabase';
import { toAppError } from './errors';

export interface SpectatorShare {
  id: string;
  athlete_user_id: string;
  code: string;
  label: string | null;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  last_viewed_at: string | null;
  view_count: number;
}

/**
 * Codes are stored as eight bare characters and shown grouped in the middle.
 * Nobody reads "K7MTQ4XB" off a phone screen accurately; "K7MT-Q4XB" they do.
 */
export function formatShareCode(code: string): string {
  const bare = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return bare.length === 8 ? `${bare.slice(0, 4)}-${bare.slice(4)}` : bare;
}

/** Strip the display grouping back off before anything is sent or compared. */
export function normaliseShareCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * The URL a QR code encodes.
 *
 * Deliberately a link to the join screen with the code in the query string, not
 * the bare code: scanned with a phone's own camera app — which is how most
 * people scan anything — a link opens straight into the spectator view, while a
 * bare code would just show them eight characters to retype.
 */
export function shareUrlFor(code: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/spectate?code=${encodeURIComponent(formatShareCode(code))}`;
}

export const spectatorRepo = {
  /** Live codes for the signed-in athlete, newest first. */
  async listMine(): Promise<SpectatorShare[]> {
    const { data, error } = await supabase
      .from('spectator_shares')
      .select('*')
      .is('revoked_at', null)
      .order('created_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load your spectator codes');
    return (data ?? []) as SpectatorShare[];
  },

  /**
   * Mint a code. Generation happens in the database (migration 041) so the code
   * is drawn from a cryptographic source and the uniqueness retry happens where
   * the unique index is, rather than in a client that can only guess.
   */
  async create(label?: string | null, expiresAt?: string | null): Promise<SpectatorShare> {
    const { data, error } = await supabase.rpc('create_spectator_share', {
      p_label: label ?? null,
      p_expires_at: expiresAt ?? null
    });
    if (error) throw toAppError(error, 'Could not create a spectator code');
    return data as SpectatorShare;
  },

  /** Retire a code. Anyone still holding it is refused as if it never existed. */
  async revoke(id: string): Promise<void> {
    const { error } = await supabase
      .from('spectator_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw toAppError(error, 'Could not revoke that code');
  },

  async rename(id: string, label: string): Promise<void> {
    const { error } = await supabase
      .from('spectator_shares')
      .update({ label: label.trim() || null })
      .eq('id', id);
    if (error) throw toAppError(error, 'Could not rename that code');
  }
};
