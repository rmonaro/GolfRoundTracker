// Client-side id minting.
//
// Rounds, holes and shots get their UUID on the DEVICE, not from Postgres. Two
// things fall out of that, and they're the whole reason for it:
//
//   1. A round can be created with no connectivity — nothing has to wait on a
//      server round-trip to learn what to call itself.
//   2. Every write becomes idempotent. Inserts become upserts on a primary key
//      the client already knows, so replaying a queued write is a no-op instead
//      of a duplicate row.
//
// The ids must be real UUIDs: the columns are `uuid` in Postgres, so a
// `tmp_1234` style id would be rejected the moment it reached the server.

/**
 * A v4 UUID.
 *
 * `crypto.randomUUID` needs a secure context and is absent on older WebViews,
 * so fall back to `getRandomValues` (universally available) rather than
 * `Math.random`, which has no collision guarantees worth relying on for
 * primary keys.
 */
export function newId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // Set the version (4) and variant (10xx) bits per RFC 4122.
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an id is safe to send to Postgres.
 *
 * Used by the persisted-store migration: rounds saved before client ids existed
 * carry `tmp_…` shot ids, which would fail on insert. Those need re-minting,
 * and this is how they're spotted.
 */
export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}
