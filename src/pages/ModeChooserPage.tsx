import { useEffect, type ReactNode } from 'react';
import {
  Box,
  Card,
  CardActionArea,
  CardContent,
  CircularProgress,
  Stack,
  Typography
} from '@mui/material';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useRoundStore } from '@/stores/roundStore';
import { useAppModeStore, homePathFor, type AppMode } from '@/stores/appModeStore';
import { useTournamentAccess } from '@/features/appMode/useTournamentAccess';
import { fullName } from '@/utils/format';

/**
 * The fork in the road, shown once per launch: Tournaments or Golf Rounds.
 *
 * Two cases resolve without asking: no tournament side at all (→ Golf Rounds),
 * and a mode already chosen this session (→ its home).
 *
 * A round in progress does NOT skip the prompt — a round that was never
 * finished would otherwise pin the player to one side forever. It gets a Resume
 * shortcut at the top instead, which picks the side that round belongs to.
 */
export function ModeChooserPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const profile = useAuthStore((s) => s.profile);
  const active = useRoundStore((s) => s.active);
  const mode = useAppModeStore((s) => s.mode);
  const setMode = useAppModeStore((s) => s.setMode);
  const { hasAccess, isResolving, isUnknown, tournamentCount, scorerGroupCount } =
    useTournamentAccess();

  // Where the user was headed before the gate bounced them here (deep link,
  // notification tap). Only honored when the mode resolves without a prompt —
  // an explicit choice should land on that side's home.
  const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname;
  const resumeTo = from && from !== '/choose' ? from : null;

  // Nothing on the tournament side means there's nothing to ask about. A failed
  // lookup is NOT nothing, though — `isUnknown` still shows both options rather
  // than quietly demoting a tournament player to the rounds-only app because TM
  // happened to be unreachable.
  const autoMode: AppMode | null = !isResolving && !hasAccess && !isUnknown ? 'rounds' : null;

  useEffect(() => {
    if (mode || !autoMode) return;
    setMode(autoMode);
    navigate(resumeTo ?? homePathFor(autoMode), { replace: true });
  }, [mode, autoMode, resumeTo, setMode, navigate]);

  if (mode) return <Navigate to={homePathFor(mode)} replace />;

  const choose = (m: AppMode, to?: string) => {
    setMode(m);
    navigate(to ?? homePathFor(m), { replace: true });
  };

  // Resuming has to set a side first — /round/play sits behind the same gate
  // that sent the player here, and a null mode would bounce them straight back.
  const resumeActive = () =>
    choose(active?.tmRegistrationId ? 'tournament' : 'rounds', '/round/play');

  if (isResolving || autoMode) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
        <Stack alignItems="center" spacing={2}>
          <CircularProgress />
          <Typography variant="body2" color="text.secondary">
            Checking your tournaments…
          </Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        px: 2,
        py: 4,
        paddingTop: 'calc(env(safe-area-inset-top) + 32px)',
        paddingBottom: 'calc(env(safe-area-inset-bottom) + 32px)'
      }}
    >
      <Stack spacing={1} sx={{ mb: 4 }}>
        <Typography variant="h4" sx={{ fontWeight: 700 }}>
          Hi, {fullName(profile?.first_name, profile?.last_name)}
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Where are you playing today?
        </Typography>
      </Stack>

      <Stack spacing={2}>
        {active && (
          <Card
            elevation={0}
            sx={{
              background: 'linear-gradient(135deg, rgba(46,125,50,0.55), rgba(76,175,80,0.35))',
              borderRadius: '5px'
            }}
          >
            <CardActionArea onClick={resumeActive}>
              <CardContent>
                <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Active round
                </Typography>
                <Typography variant="h6">{active.courseName}</Typography>
                <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.25 }}>
                  Hole {active.currentHoleIndex + 1} of {active.holesPlayed} · tap to resume
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        )}

        <ChoiceCard
          icon={<EmojiEventsRoundedIcon sx={{ fontSize: 32 }} />}
          title="Tournaments"
          subtitle={tournamentSubtitle(tournamentCount, scorerGroupCount)}
          accent="warning.main"
          onClick={() => choose('tournament')}
        />
        <ChoiceCard
          icon={<GolfCourseRoundedIcon sx={{ fontSize: 32 }} />}
          title="Golf Rounds"
          subtitle="Casual rounds, stats, bag and practice"
          accent="primary.main"
          onClick={() => choose('rounds')}
        />
      </Stack>

      <Typography variant="caption" color="text.secondary" align="center" sx={{ mt: 3 }}>
        {isUnknown
          ? "Couldn't reach tournament services — open Tournaments and refresh to try again."
          : 'You can switch sides anytime from the header.'}
      </Typography>
    </Box>
  );
}

function tournamentSubtitle(events: number, groups: number): string {
  const parts: string[] = [];
  if (events > 0) parts.push(`${events} event${events === 1 ? '' : 's'}`);
  if (groups > 0) parts.push(`${groups} group${groups === 1 ? '' : 's'} to score`);
  return parts.length ? parts.join(' · ') : 'Your registered events';
}

function ChoiceCard({
  icon,
  title,
  subtitle,
  accent,
  onClick
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  accent: string;
  onClick: () => void;
}) {
  return (
    <Card
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: '5px'
      }}
    >
      <CardActionArea onClick={onClick}>
        <CardContent sx={{ py: 2.5 }}>
          <Stack direction="row" alignItems="center" spacing={2}>
            <Box
              sx={{
                width: 60,
                height: 60,
                borderRadius: '14px',
                display: 'grid',
                placeItems: 'center',
                bgcolor: 'action.hover',
                color: accent,
                flexShrink: 0
              }}
            >
              {icon}
            </Box>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="h6">{title}</Typography>
              <Typography variant="body2" color="text.secondary">
                {subtitle}
              </Typography>
            </Box>
            <ChevronRightRoundedIcon sx={{ color: 'text.secondary' }} />
          </Stack>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}
