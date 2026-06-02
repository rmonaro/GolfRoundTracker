import type { ClubCategory } from '@/models';

/**
 * Compress a club's display name into a 2–3 character tag for tight
 * UI surfaces (e.g., the on-map club button). Examples:
 *
 *   "7 Iron"           → "7I"
 *   "9 Iron"           → "9I"
 *   "3 Wood"           → "3W"
 *   "4 Hybrid"         → "4H"
 *   "PW" / "SW" / etc. → unchanged (already abbreviated)
 *   "Pitching Wedge"   → "PW"
 *   "56° Wedge"        → "56W"
 *   "Driver"           → "Dr"
 *   "Putter"           → "Pt"
 *
 * Falls back to the first 3 characters when nothing matches so a
 * custom name like "Old Faithful" still produces SOMETHING short.
 */
export function abbreviateClubName(name: string, category?: ClubCategory): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';

  // Already short — leave alone (e.g., "PW", "SW", "GW", "LW", "AW",
  // "9I", and any custom 2-3 char nickname the user gave it).
  if (trimmed.length <= 3 && /^[A-Za-z0-9]+$/.test(trimmed)) {
    return trimmed.toUpperCase();
  }

  // "<number> Iron" → "<n>I"
  let m = trimmed.match(/^(\d+)\s*Iron$/i);
  if (m) return `${m[1]}I`;

  // "<number> Wood" → "<n>W"
  m = trimmed.match(/^(\d+)\s*Wood$/i);
  if (m) return `${m[1]}W`;

  // "<number> Hybrid" → "<n>H"
  m = trimmed.match(/^(\d+)\s*Hybrid$/i);
  if (m) return `${m[1]}H`;

  // Loft-style wedges: "56 Wedge", "56° Wedge", "60W" → "56W" / "60W"
  m = trimmed.match(/^(\d{2})°?\s*(?:W(?:edge)?)?$/i);
  if (m && category === 'wedge') return `${m[1]}W`;
  m = trimmed.match(/^(\d{2})°?\s*Wedge$/i);
  if (m) return `${m[1]}W`;

  // Named wedges: "Pitching Wedge" → "PW", "Sand Wedge" → "SW", etc.
  m = trimmed.match(/^(Pitching|Sand|Lob|Gap|Approach)\s*Wedge$/i);
  if (m) return `${m[1][0].toUpperCase()}W`;

  // Driver / Putter — give them their own short tags.
  if (/^driver$/i.test(trimmed)) return 'Dr';
  if (/^putter$/i.test(trimmed)) return 'Pt';

  // Fallback: initials of multi-word names, else first three chars.
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    return words
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 3);
  }
  return trimmed.slice(0, 3).toUpperCase();
}
