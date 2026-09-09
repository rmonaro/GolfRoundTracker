// The spectator's full-screen hole map.
//
// Deliberately the SAME map the player sees on their own round screen — same
// `HoleLayout`, same satellite imagery, same numbered shot dots with club and
// distance — minus every way to change anything. Read-only is expressed by the
// props NOT passed (see SpectatorHoleMap): no tap-to-record, no aim handle, no
// draggable dots, no pin editing. Pan and zoom stay, because looking around the
// hole is the entire point.
//
// A dialog rather than a route: the live feed, the selected round and the
// pinned hole all live in the page underneath, and pushing a route would mean
// either duplicating that state or lifting it into a store for one screen.

import { useRef } from 'react';
import {
  AppBar,
  Box,
  Chip,
  Dialog,
  IconButton,
  Stack,
  Toolbar,
  Typography
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import { SpectatorHoleMap } from './SpectatorHoleMap';
import type { RoundHole, Shot } from '@/models';

interface SpectatorMapViewProps {
  open: boolean;
  onClose: () => void;
  code: string;
  courseId: string;
  athleteName: string;
  holeNumber: number;
  /** Every hole on the card, in order — drives the prev/next arrows. */
  holes: RoundHole[];
  holeRow: RoundHole | null;
  shots: Shot[];
  clubs: Record<string, string>;
  onHoleChange: (holeNumber: number) => void;
}

export function SpectatorMapView({
  open,
  onClose,
  code,
  courseId,
  athleteName,
  holeNumber,
  holes,
  holeRow,
  shots,
  clubs,
  onHoleChange
}: SpectatorMapViewProps) {
  const recenterRef = useRef<(() => void) | null>(null);

  const numbers = holes.map((h) => h.hole_number);
  const index = numbers.indexOf(holeNumber);
  const prev = index > 0 ? numbers[index - 1] : null;
  const next = index >= 0 && index < numbers.length - 1 ? numbers[index + 1] : null;

  const strokes = (holeRow?.strokes ?? 0) + (holeRow?.penalty_strokes ?? 0);
  const played = strokes > 0;
  const vsPar = played ? strokes - (holeRow?.par ?? 0) : null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      // The map wants the whole screen; a paper background behind it would only
      // show through during the moment before tiles land.
      PaperProps={{
        sx: {
          bgcolor: 'background.default',
          // The map box below is `flex: 1`, so the paper has to be the column
          // it grows inside.
          display: 'flex',
          flexDirection: 'column'
        }
      }}
    >
      <AppBar
        position="sticky"
        color="default"
        elevation={0}
        // The native shell runs edge-to-edge (`contentInset: 'never'` in
        // capacitor.config), so a full-screen surface starts UNDER the status
        // bar and notch. PageHeader insets ordinary screens, but a Dialog
        // renders in MUI's portal and inherits none of that — the close button
        // was landing under the clock, which is a full-screen view with no way
        // out of it. Same expression RoundSummaryPage's map dialog uses; on web
        // the inset resolves to 0 and this is just the 8px gap.
        sx={{ pt: 'calc(env(safe-area-inset-top) + 8px)' }}
      >
        <Toolbar sx={{ gap: 1, minHeight: 56 }}>
          <IconButton edge="start" onClick={onClose} aria-label="Close map">
            <CloseRoundedIcon />
          </IconButton>
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              Hole {holeNumber}
            </Typography>
            <Typography variant="caption" color="text.secondary" noWrap>
              {athleteName}
              {holeRow?.par ? ` · Par ${holeRow.par}` : ''}
              {holeRow?.yardage ? ` · ${holeRow.yardage} yds` : ''}
            </Typography>
          </Box>
          {played && (
            <Chip
              size="small"
              label={`${strokes}${
                vsPar == null ? '' : vsPar === 0 ? ' · E' : vsPar > 0 ? ` · +${vsPar}` : ` · ${vsPar}`
              }`}
              color={vsPar != null && vsPar < 0 ? 'success' : 'default'}
            />
          )}
          <IconButton onClick={() => recenterRef.current?.()} aria-label="Recenter map">
            <MyLocationRoundedIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Fills whatever the toolbar leaves. `minHeight: 0` is what lets the map
          shrink inside the flex column instead of overflowing the dialog. */}
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        <SpectatorHoleMap
          code={code}
          courseId={courseId}
          holeNumber={holeNumber}
          shots={shots}
          clubs={clubs}
          compact={false}
          recenterRef={recenterRef}
        />

        {/* Hole nav floats over the map so the imagery keeps the full height.
            Arrows rather than the hole strip: at this size the viewer is
            reading one hole, and stepping is the only move they need. */}
        <Stack
          direction="row"
          spacing={1}
          sx={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 'calc(16px + env(safe-area-inset-bottom))',
            justifyContent: 'space-between',
            px: 2,
            pointerEvents: 'none'
          }}
        >
          <NavButton
            label="Previous hole"
            disabled={prev == null}
            onClick={() => prev != null && onHoleChange(prev)}
            icon={<ChevronLeftRoundedIcon />}
          />
          <NavButton
            label="Next hole"
            disabled={next == null}
            onClick={() => next != null && onHoleChange(next)}
            icon={<ChevronRightRoundedIcon />}
          />
        </Stack>
      </Box>
    </Dialog>
  );
}

function NavButton({
  label,
  icon,
  disabled,
  onClick
}: {
  label: string;
  icon: React.ReactNode;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <IconButton
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      sx={{
        // The Stack above is pointer-events:none so taps fall through to the
        // map; the buttons opt back in.
        pointerEvents: 'auto',
        bgcolor: 'background.paper',
        boxShadow: 2,
        opacity: disabled ? 0.35 : 1,
        '&:hover': { bgcolor: 'background.paper' }
      }}
    >
      {icon}
    </IconButton>
  );
}
