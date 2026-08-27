import { describe, it, expect } from 'vitest';
import {
  TEMPO_IDEAL,
  TEMPO_IDEAL_PUTT,
  fmtTempoVsTarget,
  tempoTargetFor,
  tempoVsTarget
} from './swingLabels';

describe('tempoVsTarget', () => {
  it('reports "on" inside the rules engine\'s +/-0.5 band', () => {
    for (const r of [TEMPO_IDEAL, 2.5, 3.5, 2.9]) {
      const v = tempoVsTarget(r);
      expect(v.within).toBe(true);
      expect(v.direction).toBe('on');
    }
  });

  it('calls a low ratio a quick backswing and a high one a long backswing', () => {
    // Ratio is backswing/downswing, so under target = rushed takeaway.
    expect(tempoVsTarget(2.0).direction).toBe('quick');
    expect(tempoVsTarget(4.2).direction).toBe('long');
  });

  it('signs the delta relative to the target', () => {
    expect(tempoVsTarget(2.4).delta).toBeCloseTo(-0.6, 5);
    expect(tempoVsTarget(3.6).delta).toBeCloseTo(0.6, 5);
  });

  it('formats the compact row label with its target', () => {
    expect(fmtTempoVsTarget(2.44)).toBe('2.4 (target 3.0)');
  });
});

describe('tempoVsTarget — putting', () => {
  it('targets 2:1 for a putt and 3:1 for everything else', () => {
    expect(tempoTargetFor('putt')).toBe(TEMPO_IDEAL_PUTT);
    for (const t of ['full', 'pitch', 'chip', 'air', null, undefined]) {
      expect(tempoTargetFor(t)).toBe(TEMPO_IDEAL);
    }
  });

  it('calls a textbook 2:1 putt on target — the full-swing target would not', () => {
    expect(tempoVsTarget(2.0, 'putt').within).toBe(true);
    expect(tempoVsTarget(2.0, 'putt').direction).toBe('on');
    // The regression this guards: judged as a full swing, the same stroke reads
    // as a rushed takeaway.
    expect(tempoVsTarget(2.0, 'full').within).toBe(false);
    expect(tempoVsTarget(2.0, 'full').direction).toBe('quick');
  });

  it('names the motion a backstroke on a putt', () => {
    expect(tempoVsTarget(2.0, 'putt').phase).toBe('backstroke');
    expect(tempoVsTarget(3.0, 'full').phase).toBe('backswing');
  });

  it('measures a putt delta against 2.0', () => {
    expect(tempoVsTarget(3.0, 'putt').delta).toBeCloseTo(1.0, 5);
    expect(tempoVsTarget(3.0, 'putt').direction).toBe('long');
  });

  it('formats the putt target in the compact row label', () => {
    expect(fmtTempoVsTarget(2.1, 'putt')).toBe('2.1 (target 2.0)');
  });
});
