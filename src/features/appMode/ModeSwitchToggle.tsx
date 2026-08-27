import type { ReactNode } from 'react';
import { Box, ButtonBase, Tooltip } from '@mui/material';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import { useNavigate } from 'react-router-dom';
import { useAppModeStore, homePathFor, type AppMode } from '@/stores/appModeStore';
import { useTournamentAccess } from '@/features/appMode/useTournamentAccess';
import { accentFill } from '@/theme/designTokens';

/**
 * Header control for crossing between the two sides of the app.
 *
 * Only rendered for players who actually have both — a golfer with no events has
 * one side and would just be looking at a dead switch. Sits in the PageHeader
 * `action` slot of each side's landing screen.
 */
export function ModeSwitchToggle() {
  const navigate = useNavigate();
  const mode = useAppModeStore((s) => s.mode);
  const setMode = useAppModeStore((s) => s.setMode);
  const { hasAccess, isUnknown } = useTournamentAccess();

  // `isUnknown` = TM was unreachable and there was no snapshot, so "no access"
  // is really "don't know". Keep the way across open rather than trapping a
  // tournament player who happened to launch offline.
  if ((!hasAccess && !isUnknown) || !mode) return null;

  const go = (next: AppMode) => {
    if (next === mode) return;
    setMode(next);
    navigate(homePathFor(next), { replace: true });
  };

  return (
    <Box
      role="group"
      aria-label="Switch between tournaments and rounds"
      sx={{
        display: 'flex',
        gap: '2px',
        p: '3px',
        borderRadius: '999px',
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        flexShrink: 0
      }}
    >
      <Segment
        label="Tournaments"
        selected={mode === 'tournament'}
        onClick={() => go('tournament')}
        icon={<EmojiEventsRoundedIcon sx={{ fontSize: 18 }} />}
      />
      <Segment
        label="Golf Rounds"
        selected={mode === 'rounds'}
        onClick={() => go('rounds')}
        icon={<GolfCourseRoundedIcon sx={{ fontSize: 18 }} />}
      />
    </Box>
  );
}

function Segment({
  label,
  icon,
  selected,
  onClick
}: {
  label: string;
  icon: ReactNode;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <Tooltip title={label}>
      <ButtonBase
        aria-label={label}
        aria-pressed={selected}
        onClick={onClick}
        sx={(theme) => ({
          width: 34,
          height: 34,
          borderRadius: '999px',
          color: selected ? 'primary.contrastText' : 'text.secondary',
          // The selected segment carries the accent gradient, same treatment as
          // a contained CTA. Unselected stays quiet until hovered.
          background: selected ? accentFill(theme.palette.mode, theme.palette.primary.main) : 'none',
          transition: 'color 120ms',
          '&:hover': selected
            ? undefined
            : { color: 'text.primary', bgcolor: 'action.hover' }
        })}
      >
        {icon}
      </ButtonBase>
    </Tooltip>
  );
}
