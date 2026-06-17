import { useEffect, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import GpsFixedRoundedIcon from '@mui/icons-material/GpsFixedRounded';
import WatchRoundedIcon from '@mui/icons-material/WatchRounded';
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
  const [watchConnected, setWatchConnected] = useState(false);
  const isIos = Capacitor.getPlatform() === 'ios';

  // "Connected" = a watch is paired (not live reachability, and not gated on
  // the watch app being installed — WCSession.isWatchAppInstalled is often
  // false for paired watches / dev builds). isPaired is only valid once the
  // session finishes activating (async), so a fresh launch can briefly report
  // false — retry a few times, and re-check when the page regains focus.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const check = async () => {
      try {
        const res = await watchBridge.activate();
        const connected = 'isPaired' in res && Boolean(res.isPaired);
        if (cancelled) return;
        setWatchConnected(connected);
        if (!connected && attempts < 6) {
          attempts += 1;
          timer = setTimeout(() => void check(), 500);
        }
      } catch {
        /* best-effort */
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        attempts = 0;
        void check();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

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
      <Typography variant="h5" sx={{ fontWeight: 900, fontSize: '45px', lineHeight: 1.1 }}>
        Practice
        <br />
        Session
      </Typography>

      <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px', mt: 2 }}>
        <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.5, '&:last-child': { pb: 2 } }}>
          {isIos ? (
            <svg width="26" height="34" viewBox="0 0 20 26" fill="none" style={{ flexShrink: 0 }}>
              <rect x="3" y="5" width="14" height="16" rx="4" fill="none" stroke="#324279" strokeWidth="1.6" />
              <path
                d="M6 5 6.7 1.8A1.5 1.5 0 0 1 8.2 .6h3.6a1.5 1.5 0 0 1 1.5 1.2L14 5M6 21l.7 3.2A1.5 1.5 0 0 0 8.2 25.4h3.6a1.5 1.5 0 0 0 1.5-1.2L14 21"
                stroke="#324279"
                strokeWidth="1.6"
              />
              <circle cx="10" cy="13" r="3" fill="#2f9e6e" />
            </svg>
          ) : (
            <WatchRoundedIcon
              sx={{ fontSize: 36, color: watchConnected ? 'primary.main' : 'text.disabled' }}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  flexShrink: 0,
                  bgcolor: watchConnected ? 'success.main' : 'text.disabled'
                }}
              />
              <Typography variant="body2" fontWeight={700} noWrap>
                {watchName({ title: true })} {watchConnected ? 'Connected' : 'not connected'}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {watchConnected ? 'Motion sensors ready' : 'Pair your watch to track swings'}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
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
