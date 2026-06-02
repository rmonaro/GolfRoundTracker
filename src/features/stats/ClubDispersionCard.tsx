import { useState, useEffect, useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  Chip,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import { ScatterChart } from '@mui/x-charts/ScatterChart';
import type { ClubDispersion } from './computeDispersion';

interface Props {
  rows: ClubDispersion[];
}

/** Minimum shots required before a club appears in the dispersion view.
 *  Below this the std-dev is too noisy to mean anything. */
const MIN_SHOTS_PER_CLUB = 5;

/**
 * Single shot-dispersion chart with a club picker. Only shows clubs
 * with at least MIN_SHOTS_PER_CLUB recorded shots. Defaults to the
 * most-used qualifying club (rows are pre-sorted by shotCount desc).
 */
export function ClubDispersionCard({ rows }: Props) {
  const qualifyingRows = useMemo(
    () => rows.filter((r) => r.shotCount >= MIN_SHOTS_PER_CLUB),
    [rows]
  );

  const [selectedClubId, setSelectedClubId] = useState<string | null>(
    qualifyingRows[0]?.clubId ?? null
  );

  // If the qualifying list changes (e.g., a club crosses the 5-shot
  // threshold), keep the selected club valid. Falls back to first row
  // if the prior selection is no longer present.
  useEffect(() => {
    if (qualifyingRows.length === 0) {
      setSelectedClubId(null);
      return;
    }
    if (!selectedClubId || !qualifyingRows.find((r) => r.clubId === selectedClubId)) {
      setSelectedClubId(qualifyingRows[0].clubId);
    }
  }, [qualifyingRows, selectedClubId]);

  if (qualifyingRows.length === 0) return null;

  const selected =
    qualifyingRows.find((r) => r.clubId === selectedClubId) ?? qualifyingRows[0];

  const yardageLabel =
    selected.avgYards != null
      ? selected.stdDevYards != null && selected.shotCount > 1
        ? `${selected.avgYards} ± ${selected.stdDevYards} yds`
        : `${selected.avgYards} yds`
      : '—';

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
      <CardContent>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
        >
          Shot Dispersion
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Distance variance + miss bias per club. Needs at least a few shots to be meaningful.
        </Typography>

        <Stack spacing={1.5}>
          {/* Horizontal scrollable button row — works well even with a
              full bag (12+ clubs) on a phone. ToggleButtonGroup gives
              us free single-select state + accessible aria-pressed. */}
          <Box sx={{ overflowX: 'auto', mx: -1, px: 1, pb: 0.5 }}>
            <ToggleButtonGroup
              exclusive
              value={selected.clubId}
              onChange={(_, val) => {
                if (val) setSelectedClubId(val);
              }}
              size="small"
              sx={{
                flexWrap: 'nowrap',
                '& .MuiToggleButton-root': {
                  borderRadius: '5px',
                  textTransform: 'none',
                  whiteSpace: 'nowrap',
                  px: 1.25,
                  py: 0.5,
                  fontSize: '0.8rem',
                  // Override the default group radii so each button keeps
                  // its own rounded corners instead of merging into a strip.
                  '&:not(:first-of-type)': {
                    borderLeft: '1px solid',
                    borderLeftColor: 'divider',
                    ml: 0.5,
                    borderRadius: '5px'
                  },
                  '&:not(:last-of-type)': {
                    borderRadius: '5px'
                  }
                }
              }}
            >
              {qualifyingRows.map((r) => (
                <ToggleButton key={r.clubId} value={r.clubId}>
                  {r.clubName}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="caption" color="text.secondary">
              {selected.shotCount} {selected.shotCount === 1 ? 'shot' : 'shots'} logged
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 700 }}>
              {yardageLabel}
            </Typography>
          </Stack>

          {selected.scatterPoints.length > 0 ? (
            (() => {
              // Symmetric axis bounds — pick the widest absolute lateral
              // value in the selection and pad ~20% so dots aren't pinned
              // to the chart edge. Floor at 15 yds so a perfectly straight
              // bag doesn't render with a 0-width axis.
              const maxAbs = Math.max(
                15,
                ...selected.scatterPoints.map((p) => Math.abs(p.lateralYds))
              );
              const bound = Math.ceil(maxAbs * 1.2);
              return (
                <Box sx={{ height: 220, mx: -1 }}>
                  <ScatterChart
                    height={220}
                    margin={{ top: 12, right: 16, bottom: 32, left: 40 }}
                    series={[
                      {
                        data: selected.scatterPoints.map((p, i) => ({
                          x: p.lateralYds,
                          y: p.distanceYds,
                          id: i
                        })),
                        color: '#A5D6A7',
                        // markerSize 5.7 — 5% under the original default of 6.
                        markerSize: 5.7
                      }
                    ]}
                    xAxis={[
                      {
                        label: 'Lateral (yds)',
                        min: -bound,
                        max: bound
                      }
                    ]}
                    yAxis={[{ label: 'Distance (yds)' }]}
                    slotProps={{ legend: { hidden: true } }}
                  />
                </Box>
              );
            })()
          ) : (
            <Typography variant="caption" color="text.secondary" sx={{ py: 1 }}>
              No GPS-tracked shots yet. Tap a landing point on the map while
              playing to record dispersion.
            </Typography>
          )}

          <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ rowGap: 0.5 }}>
            <BiasChip label="Hit" value={selected.hitCount} tone="success" />
            <BiasChip label="Left" value={selected.leftCount} tone="warning" />
            <BiasChip label="Right" value={selected.rightCount} tone="warning" />
            <BiasChip label="Short" value={selected.shortCount} tone="default" />
            <BiasChip label="Long" value={selected.longCount} tone="default" />
          </Stack>
        </Stack>
      </CardContent>
    </Card>
  );
}

function BiasChip({
  label,
  value,
  tone
}: {
  label: string;
  value: number;
  tone: 'success' | 'warning' | 'default';
}) {
  const isZero = value === 0;
  return (
    <Chip
      label={`${label} ${value}`}
      size="small"
      variant={isZero ? 'outlined' : 'filled'}
      color={isZero ? 'default' : tone === 'default' ? 'default' : tone}
      sx={{
        opacity: isZero ? 0.45 : 1,
        borderRadius: '5px',
        fontSize: '0.7rem',
        height: 22
      }}
    />
  );
}
