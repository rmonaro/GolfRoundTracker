import { describe, it, expect } from 'vitest';
import { evaluateSwingMetrics } from './swingFeedbackEngine';
import { OVERCLAIM_PATTERNS } from '@/utils/swingLabels';

const codesOf = (fs: ReturnType<typeof evaluateSwingMetrics>) => fs.map((f) => f.code);

describe('evaluateSwingMetrics', () => {
  it('returns nothing for an empty bundle', () => {
    // A manually-added round shot has no watch metrics at all.
    expect(evaluateSwingMetrics({})).toEqual([]);
  });

  it('fires only the rules whose inputs are present', () => {
    // Older watch builds send a partial bundle — tempo alone must still work
    // rather than the whole evaluation bailing out.
    expect(codesOf(evaluateSwingMetrics({ tempoRatio: 3.0 }))).toEqual(['TEMPO_GOOD']);
    expect(codesOf(evaluateSwingMetrics({ transitionScore: 80 }))).toEqual(['TRANSITION_SMOOTH']);
  });

  it('treats null the same as absent', () => {
    expect(
      evaluateSwingMetrics({ tempoRatio: null, transitionScore: null, finishStabilityScore: null })
    ).toEqual([]);
  });

  it('flags a rushed backswing, aggressive transition and unstable finish', () => {
    const codes = codesOf(
      evaluateSwingMetrics({ tempoRatio: 1.8, transitionScore: 20, finishStabilityScore: 30 })
    );
    expect(codes).toEqual([
      'BACKSWING_RUSHED',
      'TRANSITION_AGGRESSIVE',
      'FINISH_UNSTABLE'
    ]);
  });

  it('carries the swing id through when given one', () => {
    const [f] = evaluateSwingMetrics({ tempoRatio: 3.0 }, 'swing-1');
    expect(f.swingId).toBe('swing-1');
  });

  it('never claims launch-monitor measurements', () => {
    const all = [
      ...evaluateSwingMetrics({ tempoRatio: 3.0, transitionScore: 80, finishStabilityScore: 90 }),
      ...evaluateSwingMetrics({ tempoRatio: 1.8, transitionScore: 20, finishStabilityScore: 30 }),
      ...evaluateSwingMetrics({ tempoRatio: 5.0 })
    ];
    expect(all.length).toBeGreaterThan(0);
    for (const f of all) {
      for (const p of OVERCLAIM_PATTERNS) {
        expect(f.message).not.toMatch(p);
      }
    }
  });
});
