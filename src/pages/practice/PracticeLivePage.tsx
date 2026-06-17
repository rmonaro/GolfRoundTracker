import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography
} from '@mui/material';
import ExpandMoreRoundedIcon from '@mui/icons-material/ExpandMoreRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useNavigate } from 'react-router-dom';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { useBagStore } from '@/stores/bagStore';
import { practiceController } from '@/features/practice/practiceController';
import { SwingCard } from '@/features/practice/SwingCard';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';
import { practicePageSx } from './practicePageSx';

const IDEAL_TEMPO = 3.0;
const TEMPO_TOLERANCE = 0.5;

/** Heartbeat-style sparkline of the tempo ratio across the session. */
function TempoSparkline({ values }: { values: number[] }) {
  const w = 100;
  const h = 36;
  if (values.length < 2) {
    return (
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
        <line x1="0" y1={h / 2} x2={w} y2={h / 2} stroke="#f8893055" strokeWidth="2" />
      </svg>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w;
      const y = h - 4 - ((v - min) / range) * (h - 8);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <polyline
        points={pts}
        fill="none"
        stroke="#f88930"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Circular consistency gauge with the 0-100 score in the center. */
function ConsistencyRing({ value }: { value: number | null }) {
  const size = 104;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = value == null ? 0 : Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  return (
    <Box sx={{ position: 'relative', width: size, height: size, mx: 'auto' }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(127,127,127,0.2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="#2fd27b"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', lineHeight: 1 }}>
          {value == null ? '—' : Math.round(pct)}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          / 100
        </Typography>
      </Box>
    </Box>
  );
}

export function PracticeLivePage() {
  const navigate = useNavigate();
  const session = useSwingSessionStore((s) => s.session);
  const swings = useSwingSessionStore((s) => s.swings);
  const feedbackBySwing = useSwingSessionStore((s) => s.feedbackBySwing);
  const bag = useBagStore((s) => s.clubs);
  const [ending, setEnding] = useState(false);
  const [clubDrawer, setClubDrawer] = useState(false);

  const clubName = (() => {
    if (!session?.clubId) return 'No club selected';
    const c = bag.find((b) => b.clubId === session.clubId);
    return c ? c.customName || c.name : 'Club';
  })();

  if (!session) {
    return (
      <Box sx={practicePageSx()}>
        <Typography variant="body2" color="text.secondary">
          No active practice session.
        </Typography>
        <Button variant="contained" sx={{ mt: 2 }} onClick={() => navigate('/practice')}>
          Start one
        </Button>
      </Box>
    );
  }

  const onEnd = async () => {
    setEnding(true);
    try {
      await practiceController.end();
      // Replace the (now-ended) live page in history so the device/browser back
      // button from the summary returns to the practice overview, not a dead
      // "no active session" live screen.
      navigate('/practice/summary', { replace: true });
    } finally {
      setEnding(false);
    }
  };

  const tempos = swings
    .map((s) => s.tempoRatio)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const avgTempo = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;

  // Live consistency: lower spread of tempo => higher score (0-100).
  let consistency: number | null = null;
  if (tempos.length >= 2) {
    const mean = tempos.reduce((a, b) => a + b, 0) / tempos.length;
    const variance = tempos.reduce((a, b) => a + (b - mean) ** 2, 0) / tempos.length;
    const cv = mean ? Math.sqrt(variance) / mean : 0;
    consistency = Math.max(0, Math.min(100, Math.round(100 * (1 - cv * 3))));
  }

  const last = swings.length ? swings[swings.length - 1] : null;
  const lastTempo = last?.tempoRatio ?? null;
  const lastOnTempo = lastTempo != null && Math.abs(lastTempo - IDEAL_TEMPO) <= TEMPO_TOLERANCE;

  const reversed = [...swings].reverse();

  return (
    <Box sx={practicePageSx()}>
      {/* LIVE header */}
      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
        <Box>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: '#ff5a52',
                animation: 'livePulse 1.4s ease-out infinite',
                '@keyframes livePulse': {
                  '0%': { boxShadow: '0 0 0 0 rgba(255,90,82,0.6)' },
                  '70%': { boxShadow: '0 0 0 8px rgba(255,90,82,0)' },
                  '100%': { boxShadow: '0 0 0 0 rgba(255,90,82,0)' }
                }
              }}
            />
            <Typography sx={{ fontWeight: 700, fontSize: '11px', textTransform: 'uppercase' }}>
              Live Session
            </Typography>
          </Stack>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            Recording with {clubName}
          </Typography>
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontWeight: 800, fontSize: '2.25rem', lineHeight: 1 }}>
            {swings.length}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Swings
          </Typography>
        </Box>
      </Stack>

      {/* Club selector */}
      <Button
        variant="outlined"
        fullWidth
        endIcon={<ExpandMoreRoundedIcon />}
        onClick={() => setClubDrawer(true)}
        sx={{ mt: 2, justifyContent: 'space-between', textTransform: 'none', py: 1.25 }}
      >
        <Box component="span" sx={{ textAlign: 'left' }}>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', lineHeight: 1 }}>
            Club
          </Typography>
          <Typography sx={{ fontWeight: 700 }}>{clubName}</Typography>
        </Box>
      </Button>

      {/* AVG Tempo */}
      <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px', mt: 2 }}>
        <CardContent>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}
          >
            Avg Tempo
          </Typography>
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography sx={{ fontWeight: 800, fontSize: '2.75rem', lineHeight: 1 }}>
              {avgTempo != null ? `${avgTempo.toFixed(1)}:1` : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              ideal {IDEAL_TEMPO.toFixed(1)}:1
            </Typography>
          </Stack>
          <Box sx={{ mt: 1 }}>
            <TempoSparkline values={tempos} />
          </Box>
        </CardContent>
      </Card>

      {/* Consistency + Last swing */}
      <Stack direction="row" spacing={1.5} sx={{ mt: 1.5 }}>
        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px', flex: 1 }}>
          <CardContent sx={{ textAlign: 'center' }}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}
            >
              Consistency
            </Typography>
            <Box sx={{ mt: 1 }}>
              <ConsistencyRing value={consistency} />
            </Box>
          </CardContent>
        </Card>

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px', flex: 1 }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}
            >
              Last Swing
            </Typography>
            <Typography sx={{ fontWeight: 800, fontSize: '2rem', lineHeight: 1.1, mt: 0.5 }}>
              {lastTempo != null ? `${lastTempo.toFixed(1)}:1` : '—'}
            </Typography>
            {lastTempo != null && (
              <Chip
                size="small"
                color={lastOnTempo ? 'success' : 'warning'}
                variant="outlined"
                label={lastOnTempo ? 'On tempo' : 'Off tempo'}
                sx={{ mt: 1 }}
              />
            )}
          </CardContent>
        </Card>
      </Stack>

      <MotionDisclaimer />

      {/* Recorded swings */}
      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {reversed.length === 0 ? (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            Take a swing with your watch…
          </Typography>
        ) : (
          reversed.map((s) => (
            <SwingCard key={s.id} swing={s} feedback={feedbackBySwing[s.id] ?? []} />
          ))
        )}
      </Stack>

      <Button
        variant="outlined"
        color="error"
        fullWidth
        disabled={ending}
        onClick={onEnd}
        sx={{ mt: 3 }}
      >
        End Session
      </Button>

      {/* Club picker drawer */}
      <Drawer
        anchor="bottom"
        open={clubDrawer}
        onClose={() => setClubDrawer(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            pt: '24px',
            px: '24px',
            pb: 'calc(env(safe-area-inset-bottom) + 8px)'
          }
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography fontWeight={800} sx={{ fontSize: '1.5em' }}>
            Select club
          </Typography>
          <IconButton aria-label="Close" onClick={() => setClubDrawer(false)} sx={{ mr: -1 }}>
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
        <List sx={{ pt: 1, px: 0 }}>
          {bag.map((c) => (
            <ListItemButton
              key={c.clubId}
              selected={c.clubId === session.clubId}
              onClick={() => {
                practiceController.setClub(c.clubId);
                setClubDrawer(false);
              }}
              sx={{
                border: '1px solid',
                borderColor: 'divider',
                borderRadius: '5px',
                mb: 1,
                py: 1.25
              }}
            >
              <ListItemText
                primary={c.customName || c.name}
                primaryTypographyProps={{ fontWeight: 700 }}
              />
              <ChevronRightRoundedIcon sx={{ color: 'text.disabled', flexShrink: 0 }} />
            </ListItemButton>
          ))}
        </List>
      </Drawer>
    </Box>
  );
}
