// Per-shot swing detail for a ROUND shot, shown under the shot row on the
// round summary's Holes tab.
//
// The watch runs the SAME motion detector during a round as it does in practice
// (`RoundShotController` → `SwingMotionService`), so an auto-tracked shot
// carries the full metric bundle in `shots.swing_metrics` (migration 031).
//
// Layout follows the "Shot Card" design (Claude Design project
// 5b72db76-f5a4-43d9-b62e-b2476faca522): three hero cards — tempo, heart rate,
// estimated effort — then the feedback chips, then a grid of the relative
// quality scores, closed by the motion-estimate disclaimer.
//
// Every field is optional. Manual shots have no swing data and older watch
// builds omit individual fields, so each card renders only when its own inputs
// are present and the grid sizes itself to whatever survived.

import { Box, Stack, Typography, useTheme, type SxProps, type Theme } from '@mui/material';
import type { RoundSwingMetrics, SwingTypeValue } from '@/models';
import { backswingLengthLabel } from '@/components/swing/SwingMetricDisplay';
import { FeedbackChips } from '@/features/practice/FeedbackChips';
import { evaluateSwingMetrics } from '@/services/swingFeedbackEngine';
import { SWING_DISCLAIMER, tempoVsTarget } from '@/utils/swingLabels';
import { brand } from '@/theme/theme';

const SWING_TYPE_LABEL: Record<string, string> = {
  full: 'Full swing',
  pitch: 'Pitch',
  chip: 'Chip',
  putt: 'Putt',
  air: 'Rehearsal'
};

/**
 * True when there's at least one metric this panel actually RENDERS. Checked
 * field-by-field rather than "any non-null value" on purpose: `planeAxis` and
 * `addressGravity` are raw vectors nothing displays, so a bundle carrying only
 * those would otherwise offer an expander that opens to just the disclaimer.
 */
const DISPLAYED_FIELDS = [
  'tempoRatio',
  'backswingTimeMs',
  'downswingTimeMs',
  'transitionScore',
  'finishStabilityScore',
  'wristRotationScore',
  'releaseTimingScore',
  'decelerationScore',
  'transitionDirectionScore',
  'estimatedHandSpeed',
  'backswingRotation',
  'heartRate'
] as const satisfies readonly (keyof RoundSwingMetrics)[];

export function hasSwingDetail(metrics: RoundSwingMetrics | null | undefined): boolean {
  if (!metrics) return false;
  return DISPLAYED_FIELDS.some((k) => metrics[k] != null);
}

/** The design's 5px corner — every card, chip and input in the product. */
const RADIUS = '5px';

/**
 * Container-query breakpoint for the paired cards. Tempo and heart rate sit
 * side by side at every width, which on a phone leaves each about 155px — so
 * the hero numerals have to shrink to fit rather than overflow. A viewport
 * breakpoint can't express this: the panel is inside the summary's
 * `maxWidth="sm"` container, so the same 155px card can occur under a 1400px
 * viewport. The card measures ITSELF instead.
 */
const WIDE_CARD = '@container (min-width: 200px)';

/**
 * Score bands for the stat grid's colour accent. Deliberately wider than the
 * feedback engine's chip thresholds: the chips call out a specific coaching
 * point, whereas this is just "stands out" / "worth a look" at a glance, and
 * colouring two thirds of the grid would make none of it read as signal.
 */
function scoreColor(
  value: number,
  palette: { success: string; warning: string; primary: string }
): string {
  if (value >= 90) return palette.success;
  if (value < 70) return palette.warning;
  return palette.primary;
}

/**
 * Uppercase eyebrow label at the top of each hero card.
 *
 * `pair` reserves a second line while the card is narrow. In the phone layout
 * "TEMPO · ESTIMATED" wraps and "HEART RATE" doesn't, which dropped the tempo
 * numeral a line below the bpm one — the two headline numbers are meant to be
 * read against each other, so they need a shared baseline.
 */
function CardEyebrow({
  children,
  color,
  pair
}: {
  children: React.ReactNode;
  color?: string;
  pair?: boolean;
}) {
  return (
    <Typography
      sx={{
        fontSize: '0.75rem',
        textTransform: 'uppercase',
        letterSpacing: '0.6px',
        lineHeight: 1.4,
        color: color ?? 'text.secondary',
        ...(pair ? { minHeight: '2.8em', [WIDE_CARD]: { minHeight: 'auto' } } : null)
      }}
    >
      {children}
    </Typography>
  );
}

/** Flat 5px-cornered hero card. `sx` carries the per-card wash / tint. */
function HeroCard({
  children,
  sx
}: {
  children: React.ReactNode;
  sx?: SxProps<Theme>;
}) {
  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: 'divider',
        borderRadius: RADIUS,
        p: 2,
        minWidth: 0,
        // Makes WIDE_CARD above resolve against this card's own width.
        containerType: 'inline-size',
        ...sx
      }}
    >
      {children}
    </Box>
  );
}

/**
 * Tempo — the ratio, then the backswing/downswing split drawn to scale so the
 * two phases can be compared by eye rather than by reading two numbers.
 */
function TempoCard({
  metrics,
  swingType
}: {
  metrics: RoundSwingMetrics;
  swingType: SwingTypeValue | string | null;
}) {
  const back = metrics.backswingTimeMs;
  const down = metrics.downswingTimeMs;
  const hasSplit = back != null && down != null && back > 0 && down > 0;
  const isPutt = swingType === 'putt';
  const vs =
    metrics.tempoRatio != null ? tempoVsTarget(metrics.tempoRatio, swingType) : null;

  return (
    <HeroCard
      sx={{
        // The product's "stats" card wash. Falls back to the plain paper
        // surface in light mode, where the theme uses no gradient.
        backgroundImage: (t) =>
          t.palette.mode === 'dark'
            ? `linear-gradient(135deg, ${t.palette.success.main}22, ${brand[400]}14)`
            : 'none'
      }}
    >
      <CardEyebrow pair>Tempo · estimated</CardEyebrow>

      <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 1.25 }}>
        <Typography
          sx={{
            fontSize: '2rem',
            [WIDE_CARD]: { fontSize: '3rem' },
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-1.5px',
            fontVariantNumeric: 'tabular-nums',
            color: 'text.primary'
          }}
        >
          {metrics.tempoRatio != null ? metrics.tempoRatio.toFixed(1) : '—'}
        </Typography>
        <Typography
          sx={{
            fontSize: '1rem',
            [WIDE_CARD]: { fontSize: '1.25rem' },
            fontWeight: 700,
            color: 'text.secondary'
          }}
        >
          : 1
        </Typography>
      </Stack>

      {/* What it should have been, and by how much this swing missed it. The
          ratio on its own is unreadable without the reference — the golfer has
          no way to know 2.4 is a rushed takeaway and 3.1 is fine. Band and
          wording match the rules engine so this and the feedback chips can't
          contradict each other. */}
      {vs && (
        <Stack direction="row" alignItems="center" spacing={0.75} sx={{ mt: 0.75 }}>
          <Typography
            variant="caption"
            sx={{ color: 'text.secondary', fontVariantNumeric: 'tabular-nums' }}
          >
            Target {vs.target.toFixed(1)} : 1
          </Typography>
          <Box
            component="span"
            sx={{
              px: 0.75,
              py: 0.125,
              borderRadius: RADIUS,
              fontSize: '0.68rem',
              fontWeight: 800,
              whiteSpace: 'nowrap',
              fontVariantNumeric: 'tabular-nums',
              color: vs.within ? 'success.main' : 'warning.main',
              bgcolor: (t) =>
                `${vs.within ? t.palette.success.main : t.palette.warning.main}1f`
            }}
          >
            {vs.within
              ? 'on target'
              : `${vs.delta > 0 ? '+' : '−'}${Math.abs(vs.delta).toFixed(1)} ${
                  vs.direction === 'quick' ? 'quick' : 'long'
                } ${vs.phase}`}
          </Box>
        </Stack>
      )}

      {hasSplit && (
        <>
          <Box
            sx={{
              display: 'flex',
              gap: '4px',
              height: 8,
              borderRadius: RADIUS,
              overflow: 'hidden',
              mt: 2
            }}
          >
            <Box sx={{ flex: back, bgcolor: brand[400] }} />
            <Box sx={{ flex: down, bgcolor: brand[200] }} />
          </Box>
          {/* Side by side when the card is wide enough for both, stacked when
              it isn't — "810 ms back  270 ms down" needs ~160px and a phone
              card only has ~125px of content width. */}
          <Box
            sx={{
              mt: 1,
              display: 'flex',
              flexDirection: 'column',
              gap: 0.25,
              [WIDE_CARD]: { flexDirection: 'row', gap: 3 }
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>
                {back} ms
              </Box>{' '}
              back
            </Typography>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}
            >
              <Box component="span" sx={{ color: 'text.primary', fontWeight: 700 }}>
                {down} ms
              </Box>{' '}
              down
            </Typography>
          </Box>
        </>
      )}

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        {isPutt
          ? 'Backstroke to forward-stroke ratio · target is the 2 : 1 putting standard (the forward stroke moves through the ball about twice as fast), not a measurement of your ideal stroke'
          : 'Backswing to downswing ratio · target is the classic 3 : 1 coaching heuristic, not a measurement of your ideal swing'}
      </Typography>
    </HeroCard>
  );
}

/**
 * Heart rate — the one genuinely MEASURED value in this panel (HealthKit at the
 * moment of the strike), which is why it gets its own tinted card rather than
 * sitting in the estimated-metrics grid.
 */
function HeartRateCard({ bpm }: { bpm: number }) {
  const theme = useTheme();
  const error = theme.palette.error.main;
  return (
    <HeroCard
      sx={{
        // Tinted from the error colour rather than a hardcoded rgba, so it
        // tracks the light/dark palettes.
        bgcolor: `${error}14`,
        borderColor: `${error}73`
      }}
    >
      <CardEyebrow color={error} pair>
        Heart rate
      </CardEyebrow>

      <Stack
        direction="row"
        alignItems="baseline"
        spacing={0.75}
        sx={{ mt: 1.25, color: error }}
      >
        <Box
          component="span"
          sx={{ fontSize: '1.1rem', [WIDE_CARD]: { fontSize: '1.6rem' }, lineHeight: 1 }}
        >
          ♥
        </Box>
        <Typography
          sx={{
            fontSize: '2rem',
            [WIDE_CARD]: { fontSize: '3.5rem' },
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-2px',
            fontVariantNumeric: 'tabular-nums',
            color: 'inherit'
          }}
        >
          {Math.round(bpm)}
        </Typography>
        <Typography
          sx={{
            fontSize: '0.8rem',
            [WIDE_CARD]: { fontSize: '1rem' },
            fontWeight: 700,
            color: 'inherit'
          }}
        >
          bpm
        </Typography>
      </Stack>

      {/* Decorative ECG trace — a constant motif, NOT a plot of this shot.
          The watch reports a single bpm at impact, so there is no waveform to
          draw; presenting one as data would invent a reading we never took. */}
      <Box
        component="svg"
        viewBox="0 0 240 48"
        preserveAspectRatio="none"
        aria-hidden
        sx={{
          width: '100%',
          height: 32,
          [WIDE_CARD]: { height: 48 },
          display: 'block',
          mt: 1.5,
          overflow: 'visible'
        }}
      >
        <polyline
          points="0,32 26,32 33,26 40,32 60,32 66,32 72,8 80,44 88,24 96,32 120,32 126,32 132,8 140,44 148,24 156,32 180,32 186,32 192,8 200,44 208,24 216,32 240,32"
          fill="none"
          stroke={error}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
        At impact · watch measured
      </Typography>
    </HeroCard>
  );
}

/**
 * Estimated effort — the relative 0-100 hand-speed signal, plus the two inputs
 * that give it context. Never expressed in mph: it's derived from wrist motion,
 * not measured at the club.
 */
function EffortCard({ metrics }: { metrics: RoundSwingMetrics }) {
  const effort = metrics.estimatedHandSpeed;
  const rotation = metrics.backswingRotation;
  return (
    <HeroCard>
      <CardEyebrow>Estimated effort</CardEyebrow>

      <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ mt: 1.25 }}>
        <Typography
          sx={{
            fontSize: '3rem',
            fontWeight: 800,
            lineHeight: 1,
            letterSpacing: '-1.5px',
            fontVariantNumeric: 'tabular-nums',
            color: 'text.primary'
          }}
        >
          {effort != null ? Math.round(effort) : '—'}
        </Typography>
        <Typography sx={{ fontSize: '1rem', color: 'text.secondary' }}>/ 100</Typography>
      </Stack>

      {effort != null && (
        <Box
          sx={{
            height: 8,
            borderRadius: RADIUS,
            bgcolor: 'action.hover',
            mt: 2,
            overflow: 'hidden'
          }}
        >
          <Box
            sx={{
              width: `${Math.min(100, Math.max(0, effort))}%`,
              height: 8,
              borderRadius: RADIUS,
              bgcolor: 'primary.main'
            }}
          />
        </Box>
      )}

      {rotation != null && (
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 1 }}>
          <Typography variant="caption" color="text.secondary">
            Backswing length
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 600, color: 'text.primary' }}>
            {backswingLengthLabel(rotation)}
          </Typography>
        </Stack>
      )}
      {effort != null && (
        <Stack direction="row" justifyContent="space-between" sx={{ mt: 0.75 }}>
          <Typography variant="caption" color="text.secondary">
            Speed
          </Typography>
          <Typography
            variant="caption"
            sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'text.primary' }}
          >
            {Math.round(effort)}
          </Typography>
        </Stack>
      )}
    </HeroCard>
  );
}

/** One cell of the relative-score grid: uppercase label over a large value. */
function ScoreCell({ label, value }: { label: string; value: number }) {
  const theme = useTheme();
  const color = scoreColor(value, {
    success: theme.palette.success.main,
    warning: theme.palette.warning.main,
    primary: theme.palette.text.primary
  });
  return (
    <Box sx={{ border: 1, borderColor: 'divider', borderRadius: RADIUS, p: 1.5 }}>
      <Typography
        sx={{
          fontSize: '0.75rem',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          color: 'text.secondary',
          lineHeight: 1.3,
          // "Thru impact" wraps to two lines in a narrow cell. Reserving the
          // second line for every label keeps the six values on a shared
          // baseline instead of one cell standing a row taller than its
          // neighbours.
          minHeight: '2.6em'
        }}
      >
        {label}
      </Typography>
      <Typography
        sx={{
          mt: 0.5,
          fontSize: '2.125rem',
          fontWeight: 700,
          lineHeight: 1.1,
          fontVariantNumeric: 'tabular-nums',
          color
        }}
      >
        {Math.round(value)}
      </Typography>
    </Box>
  );
}

export function RoundSwingDetail({
  swingType,
  metrics
}: {
  swingType: SwingTypeValue | string | null;
  metrics: RoundSwingMetrics;
}) {
  // Feedback rules tolerate missing inputs — a shot with only tempo still gets
  // its tempo verdict, and nothing else fires.
  // Swing type steers the tempo target (putting is judged at 2:1, not 3:1), so
  // it has to reach the rules engine — not just the cards.
  const feedback = evaluateSwingMetrics({ ...metrics, swingType });
  const typeLabel = swingType ? SWING_TYPE_LABEL[swingType] ?? swingType : null;

  // The paired top row — tempo and heart rate, the two at-a-glance numbers.
  // Only the ones whose own inputs arrived; a lone card takes the full width.
  const topCards: React.ReactNode[] = [];
  if (
    metrics.tempoRatio != null ||
    metrics.backswingTimeMs != null ||
    metrics.downswingTimeMs != null
  ) {
    topCards.push(<TempoCard key="tempo" metrics={metrics} swingType={swingType} />);
  }
  if (metrics.heartRate != null) {
    topCards.push(<HeartRateCard key="hr" bpm={metrics.heartRate} />);
  }

  const showEffort =
    metrics.estimatedHandSpeed != null || metrics.backswingRotation != null;

  const scores: Array<[string, number]> = [];
  const pushScore = (label: string, v: number | null | undefined) => {
    if (v != null) scores.push([label, v]);
  };
  pushScore('Transition', metrics.transitionScore);
  pushScore('Finish', metrics.finishStabilityScore);
  pushScore('Wrist', metrics.wristRotationScore);
  pushScore('Release', metrics.releaseTimingScore);
  pushScore('Thru impact', metrics.decelerationScore);
  pushScore('Direction', metrics.transitionDirectionScore);

  return (
    <Box sx={{ mt: 1, mb: 0.5, border: 1, borderColor: 'divider', borderRadius: RADIUS }}>
      {typeLabel && (
        <Box sx={{ px: 2, pt: 1.5 }}>
          <CardEyebrow>{typeLabel}</CardEyebrow>
        </Box>
      )}

      {topCards.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            // Always paired, phone included — the two headline numbers are
            // meant to be read against each other. The cards resize their own
            // type to fit (see WIDE_CARD) rather than reflowing to one column.
            gridTemplateColumns: `repeat(${topCards.length}, 1fr)`,
            gap: 1.5,
            p: 2
          }}
        >
          {topCards}
        </Box>
      )}

      {feedback.length > 0 && (
        <Box sx={{ px: 2, pb: 2, pt: topCards.length > 0 ? 0 : 2 }}>
          <FeedbackChips items={feedback} />
        </Box>
      )}

      {scores.length > 0 && (
        <Box
          sx={{
            display: 'grid',
            // Fixed at three, per the design: the six scores read as one 3×2
            // block. Unlike the hero cards these cells are small enough to
            // stay legible at a phone width (~111px each at 358px), so there's
            // nothing for an auto-fit to rescue — it would just reflow the
            // block into uneven rows at in-between widths.
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 1.5,
            px: 2,
            pb: 2
          }}
        >
          {scores.map(([label, value]) => (
            <ScoreCell key={label} label={label} value={value} />
          ))}
        </Box>
      )}

      {/* Effort sits at the FOOT of the card, full width. It's the supporting
          reading — a bar and two labelled rows rather than a headline number —
          so it reads better as a closing summary than as a third card
          competing with tempo and heart rate at the top. */}
      {showEffort && (
        <Box sx={{ px: 2, pb: 2, pt: topCards.length > 0 || scores.length > 0 ? 0 : 2 }}>
          <EffortCard metrics={metrics} />
        </Box>
      )}

      <Typography
        variant="caption"
        color="text.disabled"
        sx={{ display: 'block', px: 2, py: 1.5, borderTop: 1, borderColor: 'divider' }}
      >
        {SWING_DISCLAIMER}
      </Typography>
    </Box>
  );
}
