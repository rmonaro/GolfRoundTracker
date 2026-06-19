import { Box, Typography, alpha, type SxProps, type Theme } from '@mui/material';
import { compassLabel, type WindObservation, type RelativeWind } from '@/services/weatherService';

const BUCKET_COLOR: Record<RelativeWind['bucket'], string> = {
  calm: '#94a3b8',
  helping: '#4ade80',
  hurting: '#f87171',
  crossL2R: '#fbbf24',
  crossR2L: '#fbbf24'
};

/**
 * Compact wind readout: a triangle pointing where the wind blows relative to
 * the player's target line (up = toward the target), the speed in mph, and a
 * head/tail/cross label. Two tones so it can sit on the round's dark map
 * overlay (`dark`) or the range's translucent HUD surface (`surface`).
 */
export function WindIndicator({
  wind,
  relative,
  tone = 'dark',
  circle = false,
  sx
}: {
  wind: WindObservation | null;
  relative: RelativeWind | null;
  tone?: 'dark' | 'surface';
  /** Render as a fixed-size perfect circle instead of a rounded pill. */
  circle?: boolean;
  sx?: SxProps<Theme>;
}) {
  const dark = tone === 'dark';
  const speed = wind ? Math.round(wind.speedMph) : null;
  const accent = relative ? BUCKET_COLOR[relative.bucket] : undefined;

  // Prefer the shot-relative arrow/label (up = your target line). When there's
  // no target bearing yet, still show a direction: the absolute compass arrow
  // (where the wind blows TO) plus the cardinal it blows FROM.
  const arrowDeg = relative ? relative.arrowDeg : wind ? (wind.fromDeg + 180) % 360 : null;
  const label = relative ? relative.label : wind ? `${compassLabel(wind.fromDeg)} wind` : 'mph';

  return (
    <Box
      sx={[
        {
          borderRadius: '5px',
          px: 1.25,
          py: 0.6,
          minWidth: 64,
          textAlign: 'center',
          ...(circle
            ? {
                width: 76,
                height: 76,
                minWidth: 76,
                px: 0,
                py: 0,
                borderRadius: '50%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center'
              }
            : {}),
          ...(dark
            ? {
                bgcolor: 'rgba(11,20,16,0.78)',
                color: 'common.white',
                border: 1,
                borderColor: 'rgba(255,255,255,0.18)',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.35)'
              }
            : {
                bgcolor: (theme: Theme) => alpha(theme.palette.background.paper, 0.72),
                color: 'text.primary',
                border: 1,
                borderColor: (theme: Theme) => alpha(theme.palette.divider, 0.4),
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.25)'
              })
        },
        ...(Array.isArray(sx) ? sx : [sx])
      ]}
    >
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          fontSize: '0.6rem',
          fontWeight: 700,
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          opacity: 0.8,
          lineHeight: 1
        }}
      >
        Wind
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0.5, mt: 0.3 }}>
        {wind && arrowDeg != null && (
          <Box
            component="svg"
            viewBox="0 0 24 24"
            aria-hidden
            sx={{
              width: 16,
              height: 16,
              flexShrink: 0,
              color: accent,
              transform: `rotate(${arrowDeg}deg)`
            }}
          >
            <path d="M12 2 L18 15 L12 11.5 L6 15 Z" fill="currentColor" />
          </Box>
        )}
        <Typography sx={{ fontWeight: 800, fontSize: '1.15rem', lineHeight: 1 }}>
          {speed != null ? speed : '—'}
        </Typography>
      </Box>

      <Typography
        variant="caption"
        sx={{
          display: 'block',
          fontSize: '0.6rem',
          fontWeight: 600,
          mt: 0.15,
          lineHeight: 1,
          color: accent,
          opacity: 0.95
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}
