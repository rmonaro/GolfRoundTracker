import { useState } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
import GpsFixedRoundedIcon from '@mui/icons-material/GpsFixedRounded';
import { Capacitor } from '@capacitor/core';
import { useNavigate } from 'react-router-dom';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { practiceController } from '@/features/practice/practiceController';
import { watchBridge } from '@/services/watchBridge';
import { ClubSelector } from '@/features/practice/ClubSelector';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';
import { watchName } from '@/utils/platform';
import { practicePageSx } from './practicePageSx';

export function PracticeStartPage() {
  const navigate = useNavigate();
  const activeSession = useSwingSessionStore((s) => s.session);
  const [clubId, setClubId] = useState<string | null>(activeSession?.clubId ?? null);
  const [starting, setStarting] = useState(false);
  const [launchInfo, setLaunchInfo] = useState<string | null>(null);

  const onStart = async () => {
    setStarting(true);
    setLaunchInfo(null);
    try {
      // Launch the watch straight into practice mode (HealthKit startWatchApp).
      // We surface the result so a failed launch is diagnosable in-app rather
      // than silently doing nothing.
      const result = await watchBridge.launchWatch(true);
      if (!Capacitor.isNativePlatform()) {
        setLaunchInfo('Watch launch only works on a real iPhone build.');
      } else if (result.launched) {
        setLaunchInfo(`Opening practice on your ${watchName()}…`);
      } else {
        setLaunchInfo(
          `Couldn't open the watch app automatically (${result.reason ?? 'unknown'}). ` +
            'Open Practice on the watch manually — your swings still record.'
        );
      }
      console.log('[practice] launchWatchPractice result:', result);

      // Start the phone session, but stay on this screen so the launch result
      // above stays visible. Tap "Resume live session" to go to the feed.
      await practiceController.start(clubId);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Box sx={practicePageSx()}>
      <Typography variant="h5" sx={{ fontWeight: 900, fontSize: '32px' }}>
        Watch Practice
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Uses {watchName()} motion sensors to estimate your swing tempo and
        consistency. It is not a launch monitor and does not measure ball
        flight, club path, or swing-plane angle.
      </Typography>

      <MotionDisclaimer />

      {launchInfo && (
        <Alert severity={launchInfo.startsWith('Opening') ? 'success' : 'info'} sx={{ mt: 2 }}>
          {launchInfo}
        </Alert>
      )}

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
            Then open Practice on your {watchName()} and take a swing. Detected
            swings appear here live.
          </Typography>
        </Stack>
      )}

      <Button
        sx={{ mt: 3 }}
        variant="outlined"
        fullWidth
        startIcon={<GpsFixedRoundedIcon />}
        onClick={() => navigate('/range')}
      >
        GPS Range Session
      </Button>

      <Button sx={{ mt: 1 }} variant="outlined" fullWidth onClick={() => navigate('/practice/history')}>
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
