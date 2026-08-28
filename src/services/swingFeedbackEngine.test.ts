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

  it('judges a putt against the 2:1 putting target, not 3:1', () => {
    // A textbook putting stroke. Against the full-swing target this fired
    // BACKSWING_RUSHED, which is the bug this guards.
    const putt = evaluateSwingMetrics({ tempoRatio: 2.0, swingType: 'putt' });
    expect(putt.map((f) => f.code)).toContain('TEMPO_GOOD');
    expect(evaluateSwingMetrics({ tempoRatio: 2.0 }).map((f) => f.code)).toContain(
      'BACKSWING_RUSHED'
    );
  });

  it('scales the rushed / slow thresholds to the putting target', () => {
    // target 2.0 → rushed under 1.2, slow over 3.0.
    expect(evaluateSwingMetrics({ tempoRatio: 1.0, swingType: 'putt' })[0].code).toBe(
      'BACKSWING_RUSHED'
    );
    expect(evaluateSwingMetrics({ tempoRatio: 3.4, swingType: 'putt' })[0].code).toBe(
      'BACKSWING_SLOW'
    );
    // 3.4 is fine for a full swing — the same ratio must not flag both ways.
    expect(evaluateSwingMetrics({ tempoRatio: 3.4 })[0].code).toBe('TEMPO_GOOD');
  });

  it('gives putts their own wording and explanation', () => {
    const [good] = evaluateSwingMetrics({ tempoRatio: 2.0, swingType: 'putt' });
    expect(good.explanation).toMatch(/2:1/);
    const [rushed] = evaluateSwingMetrics({ tempoRatio: 1.0, swingType: 'putt' });
    expect(rushed.message).toBe('Backstroke was rushed');
    // Full swings keep the shared by-code copy (no per-item override).
    expect(evaluateSwingMetrics({ tempoRatio: 1.0 })[0].explanation).toBeUndefined();
  });

  it('never claims launch-monitor measurements in putt copy either', () => {
    const all = [
      ...evaluateSwingMetrics({ tempoRatio: 2.0, swingType: 'putt' }),
      ...evaluateSwingMetrics({ tempoRatio: 1.0, swingType: 'putt' }),
      ...evaluateSwingMetrics({ tempoRatio: 3.4, swingType: 'putt' })
    ];
    for (const f of all) {
      for (const p of OVERCLAIM_PATTERNS) {
        expect(f.message).not.toMatch(p);
        if (f.explanation) expect(f.explanation).not.toMatch(p);
      }
    }
  });
});
