import { describe, expect, it } from 'vitest';
import { yardageKeyFor, type OpenGolfTee } from './opengolf.ts';

/** The yardage keys a hole payload publishes, as `yardageKeyFor` wants them. */
const keys = (...names: string[]) => new Map(names.map((n) => [n.toLowerCase(), n]));

const tee = (partial: Partial<OpenGolfTee>): OpenGolfTee => partial;

describe('yardageKeyFor', () => {
  it('uses the published colour when there is one', () => {
    // Bayou Lakeview: { tee_name: "Blue", tee_color: "blue", tee_key: "blue-male" }
    const t = tee({ tee_name: 'Blue', tee_color: 'blue', tee_key: 'blue-male' });
    expect(yardageKeyFor(t, keys('blue', 'black', 'white', 'copper'))).toBe('blue');
  });

  it('falls back to tee_key when the colour is null', () => {
    // The real failure: Copper publishes no colour, but every hole carries
    // "copper". Before this fallback the tee stored no per-hole yardages at all.
    const t = tee({ tee_name: 'Copper', tee_color: null, tee_key: 'copper-male' });
    expect(yardageKeyFor(t, keys('blue', 'black', 'white', 'copper'))).toBe('copper');
  });

  it('strips the gender suffix from tee_key, not the colour itself', () => {
    const t = tee({ tee_name: 'Red', tee_color: null, tee_key: 'red-female' });
    expect(yardageKeyFor(t, keys('red'))).toBe('red');
  });

  it('falls back to the tee name when neither colour nor key matches', () => {
    const t = tee({ tee_name: 'Championship', tee_color: null, tee_key: null });
    expect(yardageKeyFor(t, keys('championship', 'members'))).toBe('championship');
  });

  it('matches case-insensitively but returns the key as published', () => {
    const t = tee({ tee_name: 'Gold', tee_color: 'Gold', tee_key: null });
    expect(yardageKeyFor(t, keys('Gold'))).toBe('Gold');
  });

  it('returns null when the holes payload has nothing for this tee', () => {
    // 12% of tee sets in a 30-course sample. The tee is still stored — it has
    // ratings and a total — it just carries no per-hole list.
    const t = tee({ tee_name: 'Combo', tee_color: null, tee_key: 'combo-male' });
    expect(yardageKeyFor(t, keys('blue', 'white'))).toBeNull();
  });

  it('does not match on an empty colour, key or name', () => {
    expect(yardageKeyFor(tee({ tee_name: '', tee_color: '', tee_key: '' }), keys(''))).toBeNull();
  });

  it('prefers the colour over a tee_key that points somewhere else', () => {
    const t = tee({ tee_name: 'Blue', tee_color: 'blue', tee_key: 'white-male' });
    expect(yardageKeyFor(t, keys('blue', 'white'))).toBe('blue');
  });
});
