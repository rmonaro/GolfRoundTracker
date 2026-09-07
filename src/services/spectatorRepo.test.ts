import { describe, expect, it } from 'vitest';
import { formatShareCode, normaliseShareCode } from './spectatorRepo';

describe('normaliseShareCode', () => {
  it('accepts the code however it was typed or pasted', () => {
    // Every one of these is the same code. A grandparent reading it off a text
    // message will produce some of them, and a paste will produce the rest.
    for (const input of [
      'K7MTQ4XB',
      'k7mtq4xb',
      'K7MT-Q4XB',
      'K7MT Q4XB',
      '  k7mt-q4xb  ',
      'K7MT–Q4XB' // en dash, courtesy of an autocorrecting keyboard
    ]) {
      expect(normaliseShareCode(input)).toBe('K7MTQ4XB');
    }
  });

  it('strips anything that is not a code character', () => {
    expect(normaliseShareCode('K7MT_Q4XB!')).toBe('K7MTQ4XB');
    expect(normaliseShareCode('')).toBe('');
  });
});

describe('formatShareCode', () => {
  it('groups an eight character code in the middle', () => {
    expect(formatShareCode('K7MTQ4XB')).toBe('K7MT-Q4XB');
    expect(formatShareCode('k7mt-q4xb')).toBe('K7MT-Q4XB');
  });

  it('leaves a partial code ungrouped while it is being typed', () => {
    // The join field re-formats on every keystroke, so this runs against every
    // prefix. Inserting a dash early would fight the person typing.
    expect(formatShareCode('K7M')).toBe('K7M');
    expect(formatShareCode('K7MTQ4X')).toBe('K7MTQ4X');
    expect(formatShareCode('')).toBe('');
  });

  it('round-trips with normaliseShareCode', () => {
    const bare = 'K7MTQ4XB';
    expect(normaliseShareCode(formatShareCode(bare))).toBe(bare);
  });

  it('does not grow a second dash when a formatted code is re-formatted', () => {
    expect(formatShareCode(formatShareCode('K7MTQ4XB'))).toBe('K7MT-Q4XB');
  });
});
