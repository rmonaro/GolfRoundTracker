import { Box, Stack, Typography } from '@mui/material';

/**
 * Reusable scorecard view. Renders a header row (player + Gross / Net / Pts
 * totals), two 9-hole grids (Hole / SI / Par / Score / Pts), and a
 * color-coded legend. Designed to be dropped into any page that shows a
 * round's hole-by-hole detail — round summary, past-round detail, share
 * sheets, etc.
 *
 * Score cells are color-coded by stroke vs. par per hole:
 *   ≤ −2  Eagle      → green
 *      −1 Birdie     → blue
 *       0 Par        → muted gray
 *      +1 Bogey      → red
 *   ≥ +2 Double+     → darker red
 *
 * Stableford points are computed per hole as `max(0, 2 + (par − score))`
 * (Eagle = 4, Birdie = 3, Par = 2, Bogey = 1, Double+ = 0). Net Stableford
 * (with per-hole handicap strokes) is intentionally out of scope for v1;
 * the prop surface leaves room to add `strokeIndex` later.
 */

export interface ScorecardHole {
  hole_number: number;
  par: number;
  strokes: number;
  penalty_strokes: number;
  /** Course handicap rank for this hole (1 = hardest). Renders "—" if absent. */
  stroke_index?: number | null;
}

export interface ScorecardProps {
  /** Player full name. Defaults to "—" if missing. */
  playerName?: string | null;
  /** Player's handicap. Used for the Net total and the DHC line. Null/undefined hides Net. */
  handicap?: number | null;
  holes: ScorecardHole[];
}

interface NineRowData {
  label: string;
  totalLabel: string;
  rows: ScorecardHole[];
}

const SCORE_COLORS = {
  eagle: '#16a34a', // green
  birdie: '#3b82f6', // blue
  par: '#6b7280', // muted gray
  bogey: '#ef4444', // red
  doublePlus: '#b91c1c', // darker red
  empty: 'rgba(255,255,255,0.06)'
} as const;

function holeScore(h: ScorecardHole): number {
  return (h.strokes || 0) + (h.penalty_strokes || 0);
}

function scoreColor(strokes: number, par: number): string {
  if (strokes === 0) return SCORE_COLORS.empty;
  const diff = strokes - par;
  if (diff <= -2) return SCORE_COLORS.eagle;
  if (diff === -1) return SCORE_COLORS.birdie;
  if (diff === 0) return SCORE_COLORS.par;
  if (diff === 1) return SCORE_COLORS.bogey;
  return SCORE_COLORS.doublePlus;
}

/** Stableford points for the hole. Gross-only (no per-hole handicap adjustment). */
function stablefordPoints(h: ScorecardHole): number {
  const score = holeScore(h);
  if (score === 0) return 0;
  return Math.max(0, 2 + (h.par - score));
}

export function Scorecard({ playerName, holes }: ScorecardProps) {
  const front = holes.filter((h) => h.hole_number <= 9);
  const back = holes.filter((h) => h.hole_number > 9);

  const grossTotal = holes.reduce((s, h) => s + holeScore(h), 0);

  return (
    <Box
      sx={{
        bgcolor: 'background.paper',
        borderRadius: '5px',
        overflow: 'hidden',
        border: 1,
        borderColor: 'divider'
      }}
    >
      <ScorecardHeader playerName={playerName ?? '—'} gross={grossTotal} />
      <Box sx={{ overflowX: 'auto' }}>
        {front.length > 0 && (
          <NineGrid label="Hole" totalLabel="OUT" rows={front} />
        )}
        {back.length > 0 && (
          <NineGrid label="Hole" totalLabel="IN" rows={back} />
        )}
      </Box>
      <Legend holes={holes} />
    </Box>
  );
}

/**
 * Tally each score category across all played holes. Skips holes the user
 * hasn't started (score = 0) so the counts only reflect actual play.
 */
function tallyByCategory(holes: ScorecardHole[]) {
  let eagle = 0;
  let birdie = 0;
  let par = 0;
  let bogey = 0;
  let doublePlus = 0;
  for (const h of holes) {
    const score = holeScore(h);
    if (score === 0) continue;
    const diff = score - h.par;
    if (diff <= -2) eagle++;
    else if (diff === -1) birdie++;
    else if (diff === 0) par++;
    else if (diff === 1) bogey++;
    else doublePlus++;
  }
  return { eagle, birdie, par, bogey, doublePlus };
}

// ---------------------------------------------------------------------------
// Header — player name + DHC + Gross / Net / Pts totals
// ---------------------------------------------------------------------------

function ScorecardHeader({
  playerName,
  gross
}: {
  playerName: string;
  gross: number;
}) {
  return (
    <Box sx={{ px: 1.5, py: 1.25, borderBottom: 1, borderColor: 'divider' }}>
      <Stack direction="row" alignItems="center" spacing={1.5}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }} noWrap>
            {playerName}
          </Typography>
        </Box>
        <TotalChip label="Gross" value={gross} />
      </Stack>
    </Box>
  );
}

function TotalChip({
  label,
  value,
  highlight
}: {
  label: string;
  value: number;
  highlight?: boolean;
}) {
  return (
    <Box sx={{ textAlign: 'center', minWidth: 36 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', lineHeight: 1, mb: 0.25 }}
      >
        {label}
      </Typography>
      <Box
        sx={
          highlight
            ? {
                bgcolor: SCORE_COLORS.eagle,
                color: 'common.white',
                borderRadius: '5px',
                px: 0.75,
                py: 0.25,
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums'
              }
            : {
                fontWeight: 800,
                fontVariantNumeric: 'tabular-nums',
                color: SCORE_COLORS.bogey
              }
        }
      >
        {value || '—'}
      </Box>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// One 9-hole grid (Front 9 / Back 9): Hole, SI, Par, Score, Pts rows
// ---------------------------------------------------------------------------

function NineGrid({ totalLabel, rows }: NineRowData) {
  const parTotal = rows.reduce((s, h) => s + (h.par || 0), 0);
  const scoreTotal = rows.reduce((s, h) => s + holeScore(h), 0);

  const cols = `60px repeat(${rows.length}, minmax(28px, 1fr)) 44px`;

  return (
    <Box sx={{ fontVariantNumeric: 'tabular-nums', fontSize: 12 }}>
      <GridRow cols={cols} bg="transparent">
        <RowLabel>Hole</RowLabel>
        {rows.map((h) => (
          <Cell key={`hn-${h.hole_number}`} muted>
            {h.hole_number}
          </Cell>
        ))}
        <Cell bold>{totalLabel}</Cell>
      </GridRow>

      <GridRow cols={cols}>
        <RowLabel muted>Par</RowLabel>
        {rows.map((h) => (
          <Cell key={`par-${h.hole_number}`} muted>
            {h.par || '—'}
          </Cell>
        ))}
        <Cell bold>{parTotal || '—'}</Cell>
      </GridRow>

      <GridRow cols={cols}>
        <RowLabel>Score</RowLabel>
        {rows.map((h) => {
          const score = holeScore(h);
          return (
            <Box
              key={`s-${h.hole_number}`}
              sx={{
                mx: 0.25,
                my: 0.5,
                py: 0.5,
                borderRadius: '5px',
                textAlign: 'center',
                fontWeight: 800,
                color: score === 0 ? 'text.secondary' : 'common.white',
                bgcolor: scoreColor(score, h.par)
              }}
            >
              {score || '—'}
            </Box>
          );
        })}
        <Cell bold>{scoreTotal || '—'}</Cell>
      </GridRow>
    </Box>
  );
}

function GridRow({
  cols,
  bg,
  highlight,
  children
}: {
  cols: string;
  bg?: string;
  highlight?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: cols,
        alignItems: 'center',
        bgcolor: bg ?? 'transparent',
        // Subtle separator between rows when not highlighted.
        borderTop: highlight ? 'none' : 1,
        borderColor: 'divider'
      }}
    >
      {children}
    </Box>
  );
}

function RowLabel({
  children,
  muted,
  inverse
}: {
  children: React.ReactNode;
  muted?: boolean;
  inverse?: boolean;
}) {
  return (
    <Box
      sx={{
        px: 1.25,
        py: 0.75,
        fontWeight: 700,
        color: inverse ? 'common.white' : muted ? 'text.secondary' : 'text.primary',
        textTransform: 'uppercase',
        fontSize: 11,
        letterSpacing: 0.4
      }}
    >
      {children}
    </Box>
  );
}

function Cell({
  children,
  bold,
  muted,
  inverse
}: {
  children: React.ReactNode;
  bold?: boolean;
  muted?: boolean;
  inverse?: boolean;
}) {
  return (
    <Box
      sx={{
        textAlign: 'center',
        py: 0.75,
        fontWeight: bold ? 800 : 600,
        color: inverse ? 'common.white' : muted ? 'text.secondary' : 'text.primary'
      }}
    >
      {children}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Legend strip — colored swatches for each score class
// ---------------------------------------------------------------------------

/**
 * Per-round category tally. The colored swatches now carry the count of
 * each score class the user actually recorded this round (eagles, birdies,
 * pars, bogeys, double-or-worse). Categories with zero count still render
 * so the player sees the full distribution at a glance.
 */
function Legend({ holes }: { holes: ScorecardHole[] }) {
  const counts = tallyByCategory(holes);
  const items: Array<{ count: number; sub: string; color: string }> = [
    { count: counts.eagle, sub: 'Eagle', color: SCORE_COLORS.eagle },
    { count: counts.birdie, sub: 'Birdie', color: SCORE_COLORS.birdie },
    { count: counts.par, sub: 'Par', color: SCORE_COLORS.par },
    { count: counts.bogey, sub: 'Bogey', color: SCORE_COLORS.bogey },
    { count: counts.doublePlus, sub: 'Double', color: SCORE_COLORS.doublePlus }
  ];
  return (
    <Stack
      direction="row"
      spacing={1.5}
      sx={{
        px: 1.5,
        py: 1,
        borderTop: 1,
        borderColor: 'divider',
        flexWrap: 'wrap',
        rowGap: 0.5
      }}
    >
      {items.map((it) => {
        const empty = it.count === 0;
        return (
          <Stack key={it.sub} direction="row" alignItems="center" spacing={0.5}>
            <Box
              sx={{
                width: 22,
                height: 18,
                borderRadius: '5px',
                bgcolor: it.color,
                color: 'common.white',
                display: 'grid',
                placeItems: 'center',
                fontSize: 11,
                fontWeight: 800,
                // Dim categories the user didn't hit this round so the
                // colors they DID earn pop.
                opacity: empty ? 0.35 : 1
              }}
            >
              {it.count}
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ opacity: empty ? 0.6 : 1 }}
            >
              {it.sub}
            </Typography>
          </Stack>
        );
      })}
    </Stack>
  );
}
