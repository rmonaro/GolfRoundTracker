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
 * Public web origin the spectator link should point at, e.g.
 * `https://rounds.example.com`. Set it in `.env` as VITE_PUBLIC_WEB_URL.
 *
 * DELIBERATELY EMPTY TODAY — the app ships only as a Capacitor build, so there
 * is no web address a link could point at. Inside Capacitor
 * `window.location.origin` is `capacitor://localhost` (iOS) or
 * `http://localhost` (Android): a scheme that resolves only on the athlete's
 * own phone, so a QR built from it encodes a link nobody else's camera can
 * open, and the share sheet texts the same dead URL.
 *
 * With no base the code itself is the payload, which is the right answer for a
 * native-only app anyway: the spectator needs the app installed regardless, and
 * the join screen's own scanner reads a bare code (`codeFromScan`). This exists
 * so that shipping a web build later is a one-line change rather than a hunt.
 */
const PUBLIC_WEB_BASE = (import.meta.env.VITE_PUBLIC_WEB_URL as string | undefined)
  ?.trim()
  .replace(/\/+$/, '');

/**
 * The URL a QR code encodes, or null when we have no origin worth handing out.
 *
 * Deliberately a link to the join screen with the code in the query string, not
 * the bare code: scanned with a phone's own camera app — which is how most
 * people scan anything — a link opens straight into the spectator view, while a
 * bare code would just show them eight characters to retype.
 *
 * Null rather than a broken string: a QR that silently goes nowhere is worse
 * than no QR, because the athlete has no way to tell. Callers fall back to the
 * code itself, which always works.
 */
export function shareUrlFor(code: string): string | null {
  const runtime =
    typeof window !== 'undefined' && /^https?:$/.test(window.location.protocol)
      ? window.location.origin
      : null;
  const base = PUBLIC_WEB_BASE || runtime;
  if (!base) return null;
  return `${base}/spectate?code=${encodeURIComponent(formatShareCode(code))}`;
}

/** A code saved against a viewer's account — see migration 045. */
export interface SpectatorFollow {
  id: string;
  code: string;
  athlete_name: string | null;
  created_at: string;
  /** The athlete has retired this code; the follow is a dead bookmark. */
  revoked?: boolean;
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

  /**
   * The athlete's code, minting one on first use.
   *
   * Creating a code was a deliberate act the golfer had to remember to perform
   * BEFORE anyone wanted to watch — which is the wrong moment to discover it,
   * standing on the first tee with a parent asking how to follow along. There
   * is nothing to decide: a code exposes tournament rounds and nothing else, so
   * having one costs nothing and it can always be revoked.
   *
   * Idempotent, and deliberately returns the existing code rather than adding
   * to it — a screen that mints a fresh code on every visit would hand out a
   * different number each time and quietly invalidate the one already texted to
   * someone.
   *
   * This is now the ONLY way a code gets made: the share screen has no create
   * form, so an athlete has exactly one code, rotated by revoking it. `create`
   * remains the primitive underneath and is still reachable if a reason to hand
   * out per-person codes ever comes back.
   */
  async ensureShare(label?: string | null): Promise<SpectatorShare> {
    const existing = await this.listMine();
    if (existing.length > 0) return existing[0];
    return this.create(label ?? null);
  },

  /** Retire a code. Anyone still holding it is refused as if it never existed. */
  async revoke(id: string): Promise<void> {
    const { error } = await supabase
      .from('spectator_shares')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw toAppError(error, 'Could not revoke that code');
  },

  /**
   * Save a code to the signed-in viewer's account (migration 045).
   *
   * Bookmarking, not a grant: reads still go through the edge function with the
   * code, and the athlete revoking it cuts the follow off at the next poll.
   */
  async follow(code: string): Promise<SpectatorFollow> {
    const { data, error } = await supabase.rpc('follow_spectator_share', {
      p_code: normaliseShareCode(code)
    });
    if (error) throw toAppError(error, 'Could not save that athlete');
    return data as SpectatorFollow;
  },

  /** Saved athletes, newest first. Revoked ones are included and flagged. */
  async listFollows(): Promise<SpectatorFollow[]> {
    const { data, error } = await supabase.rpc('list_spectator_follows');
    if (error) throw toAppError(error, 'Could not load your saved athletes');
    return (data ?? []) as SpectatorFollow[];
  },

  async unfollow(id: string): Promise<void> {
    const { error } = await supabase.from('spectator_follows').delete().eq('id', id);
    if (error) throw toAppError(error, 'Could not remove that athlete');
  },

  async rename(id: string, label: string): Promise<void> {
    const { error } = await supabase
      .from('spectator_shares')
      .update({ label: label.trim() || null })
      .eq('id', id);
    if (error) throw toAppError(error, 'Could not rename that code');
  }
};
