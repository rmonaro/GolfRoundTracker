import { useMemo, useState } from 'react';
import { Box, Button, Chip, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { useBagStore } from '@/stores/bagStore';
import { practiceController } from '@/features/practice/practiceController';
import { SwingCard } from '@/features/practice/SwingCard';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';
import { practicePageSx } from './practicePageSx';

export function PracticeLivePage() {
  const navigate = useNavigate();
  const session = useSwingSessionStore((s) => s.session);
  const swings = useSwingSessionStore((s) => s.swings);
  const feedbackBySwing = useSwingSessionStore((s) => s.feedbackBySwing);
  const bag = useBagStore((s) => s.clubs);
  const [ending, setEnding] = useState(false);

  const clubName = useMemo(() => {
    if (!session?.clubId) return 'No club';
    const c = bag.find((b) => b.clubId === session.clubId);
    return c ? c.customName || c.name : 'Club';
  }, [session?.clubId, bag]);

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
      navigate('/practice/summary');
    } finally {
      setEnding(false);
    }
  };

  const reversed = [...swings].reverse();

  return (
    <Box sx={{ p: 2, maxWidth: 520, mx: 'auto' }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h6" fontWeight={800}>
          Live Swing Feed
        </Typography>
        <Chip label={clubName} size="small" />
      </Stack>
      <MotionDisclaimer />

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 2 }}>
        <Typography variant="body2" color="text.secondary">
          {swings.length} swing{swings.length === 1 ? '' : 's'}
        </Typography>
        <Button variant="outlined" color="error" disabled={ending} onClick={onEnd}>
          End Session
        </Button>
      </Stack>

      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {reversed.length === 0 && (
          <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
            Take a swing with your watch…
          </Typography>
        )}
        {reversed.map((s) => (
          <SwingCard key={s.id} swing={s} feedback={feedbackBySwing[s.id] ?? []} />
        ))}
      </Stack>
    </Box>
  );
}
