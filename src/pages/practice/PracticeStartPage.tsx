import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { practiceController } from '@/features/practice/practiceController';
import { watchBridge } from '@/services/watchBridge';
import { ClubSelector } from '@/features/practice/ClubSelector';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';
import { practicePageSx } from './practicePageSx';

export function PracticeStartPage() {
  const navigate = useNavigate();
  const activeSession = useSwingSessionStore((s) => s.session);
  const [clubId, setClubId] = useState<string | null>(activeSession?.clubId ?? null);
  const [starting, setStarting] = useState(false);

  const onStart = async () => {
    setStarting(true);
    try {
      // Launch the watch straight into practice mode (HealthKit startWatchApp).
      // Fire-and-forget — the phone session still works if the watch can't be
      // brought up (e.g. not paired, HealthKit not authorized).
      void watchBridge.launchWatchPractice();
      const id = await practiceController.start(clubId);
      if (id) navigate('/practice/live');
    } finally {
      setStarting(false);
    }
  };

  return (
    <Box sx={practicePageSx()}>
      <Typography variant="h5" fontWeight={800}>
        Watch Practice
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Uses Apple Watch motion sensors to estimate your swing tempo and
        consistency. It is not a launch monitor and does not measure ball
        flight, club path, or swing-plane angle.
      </Typography>

      <MotionDisclaimer />

      {activeSession ? (
        <Stack spacing={2} sx={{ mt: 3 }}>
          <Typography variant="body2">A practice session is already in progress.</Typography>
          <Button variant="contained" onClick={() => navigate('/practice/live')}>
            Resume live session
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ mt: 3 }}>
          <ClubSelector value={clubId} onChange={setClubId} label="Select club (optional)" />
          <Button variant="contained" size="large" disabled={starting} onClick={onStart}>
            Start Watch Practice
          </Button>
          <Typography variant="caption" color="text.secondary">
            Then open Practice on your Apple Watch and take a swing. Detected
            swings appear here live.
          </Typography>
        </Stack>
      )}

      <Button sx={{ mt: 3 }} variant="outlined" fullWidth onClick={() => navigate('/practice/history')}>
        View past practices
      </Button>

      <Button sx={{ mt: 1 }} fullWidth onClick={() => navigate('/practice/guide')}>
        What's measured & what it means
      </Button>

      <Button sx={{ mt: 1 }} onClick={() => navigate('/')}>
        Back
      </Button>
    </Box>
  );
}
