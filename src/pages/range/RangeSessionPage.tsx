import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography
} from '@mui/material';
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from '@/stores/authStore';
import { useBagStore } from '@/stores/bagStore';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { ClubSelector } from '@/features/practice/ClubSelector';
import { ensureGpsPermission, getCurrentPosition } from '@/services/gpsService';
import { rangeRepo } from '@/services/rangeRepo';
import { practiceController } from '@/features/practice/practiceController';
import { watchBridge } from '@/services/watchBridge';
import {
  onSwing,
  offSwing,
  resolveSwingEventId,
  __devEmitSwing,
  type SwingEvent
} from '@/services/rangeSwingBridge';
import { RangeMap, type ShotMarker } from '@/features/range/RangeMap';
import { computeClubSummaries, shotChipLabel } from '@/features/range/rangeStats';
import type { LatLng, RangeSession, RangeShot } from '@/types/range';

type Phase = 'locating' | 'denied' | 'set-target' | 'logging';

export function RangeSessionPage() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const bag = useBagStore((s) => s.clubs);

  const [phase, setPhase] = useState<Phase>('locating');
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [session, setSession] = useState<RangeSession | null>(null);
  const [shots, setShots] = useState<RangeShot[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [lastChip, setLastChip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // When a swing event arrives (deferred bridge), it drives the next tap:
  // pre-fill club + swing_event_id. In v1 the stub never fires, so the manual
  // tap path stays active. The screen needs no change when the bridge lands.
  const pendingSwingRef = useRef<SwingEvent | null>(null);
  const [pendingSwing, setPendingSwing] = useState<SwingEvent | null>(null);

  const clubLabel = useCallback(
    (clubId: string | null): string | null => {
      if (!clubId) return null;
      const c = bag.find((b) => b.clubId === clubId);
      return c ? c.customName || c.name : null;
    },
    [bag]
  );

  // --- Phase A: capture origin once (or restore an open session) ----------
  const captureOrigin = useCallback(async () => {
    setPhase('locating');
    setError(null);
    try {
      await ensureGpsPermission();
      const pt = await getCurrentPosition({ enableHighAccuracy: true });
      setOrigin({ lat: pt.lat, lng: pt.lng });
      setPhase('set-target');
    } catch (err) {
      console.warn('[range] location failed', err);
      setPhase('denied');
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Restore an in-progress session (survives reloads) before asking for GPS.
      if (userId) {
        try {
          const open = await rangeRepo.getOpenSession(userId);
          if (open && !cancelled) {
            const sShots = await rangeRepo.getSessionShots(open.id);
            if (cancelled) return;
            setSession(open);
            setOrigin(open.origin);
            setShots(sShots);
            setPhase('logging');
            return;
          }
        } catch (err) {
          console.warn('[range] restore failed', err);
        }
      }
      if (!cancelled) void captureOrigin();
    })();
    return () => {
      cancelled = true;
    };
  }, [userId, captureOrigin]);

  // --- Integration seam: register the swing handler -----------------------
  useEffect(() => {
    onSwing((e) => {
      pendingSwingRef.current = e;
      setPendingSwing(e);
    });
    return () => offSwing();
  }, []);

  // --- Watch practice: auto-start tracking when the range session opens ----
  // Launch the watch into practice mode and open a phone swing session, so
  // tempo/HR/consistency record (via usePracticeWatchSync at the app root) and
  // detected swings flow into the bridge above. Native-only — there's no watch
  // in the browser, so we don't spin up empty practice sessions there.
  const watchStartedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'logging' || watchStartedRef.current) return;
    if (!Capacitor.isNativePlatform()) return;
    watchStartedRef.current = true;
    void watchBridge.launchWatch(true);
    void practiceController.start(selectedClubId);
  }, [phase, selectedClubId]);

  // Keep the watch practice session's club in sync with the range selector
  // (no-op until the watch supplies its own club). Safe when no session exists.
  useEffect(() => {
    if (phase === 'logging') practiceController.setClub(selectedClubId);
  }, [selectedClubId, phase]);

  // --- taps ---------------------------------------------------------------
  const handleTap = useCallback(
    async (p: LatLng) => {
      if (busy) return;

      if (phase === 'set-target' && origin && userId) {
        setBusy(true);
        setError(null);
        try {
          const created = await rangeRepo.createSession(userId, origin, p);
          setSession(created);
          setPhase('logging');
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not start session');
        } finally {
          setBusy(false);
        }
        return;
      }

      if (phase === 'logging' && session) {
        setBusy(true);
        setError(null);
        // A pending swing event (from the watch bridge) wins over the manual
        // club selector and supplies the swing_event_id.
        const swing = pendingSwingRef.current;
        const club = swing?.club ?? clubLabel(selectedClubId);
        // Only link a real (persisted) swing_metrics uuid; null otherwise.
        const swingEventId = swing ? resolveSwingEventId(swing.id) : null;
        try {
          const shot = await rangeRepo.logShot({ session, land: p, club, swingEventId });
          setShots((prev) => [...prev, shot]);
          setLastChip(shotChipLabel(shot.carryYards, shot.offlineYards));
          pendingSwingRef.current = null;
          setPendingSwing(null);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Could not log shot');
        } finally {
          setBusy(false);
        }
      }
    },
    [busy, phase, origin, userId, session, selectedClubId, clubLabel]
  );

  // Single end path, used by BOTH the phone "End" button and the watch ending
  // its session. Idempotent via `endingRef` so the two can't double-fire (and
  // so the phone→watch→phone echo doesn't re-trigger).
  const endingRef = useRef(false);
  const finishSession = useCallback(
    async (initiator: 'phone' | 'watch') => {
      if (!session) {
        navigate('/practice');
        return;
      }
      if (endingRef.current) return;
      endingRef.current = true;
      setBusy(true);
      try {
        // Phone-initiated: tell the watch to stop too. (Watch-initiated already
        // ended on the watch, so we skip the command to avoid a loop.)
        if (initiator === 'phone') void watchBridge.endWatchPractice();
        // Finalize the watch practice session (rollups, ended_at). No-op when
        // none is active or it's already been ended by the watch.
        if (useSwingSessionStore.getState().session) {
          try {
            await practiceController.end();
          } catch (err) {
            console.warn('[range] ending watch practice failed', err);
          }
        }
        await rangeRepo.endSession(session.id);
        navigate(`/range/summary/${session.id}`);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not end session');
        setBusy(false);
        endingRef.current = false; // allow retry
      }
    },
    [session, navigate]
  );

  const onEnd = useCallback(() => void finishSession('phone'), [finishSession]);

  // Watch ended its session (user tapped End on the watch, or the watch app
  // closed) → the root practice-sync clears the swing session. When that
  // happens during an active range session we started, end the range session
  // too and move to the summary.
  const practiceSession = useSwingSessionStore((s) => s.session);
  const prevPracticeSessionRef = useRef(practiceSession);
  useEffect(() => {
    const prev = prevPracticeSessionRef.current;
    prevPracticeSessionRef.current = practiceSession;
    if (
      phase === 'logging' &&
      watchStartedRef.current &&
      prev &&
      !practiceSession &&
      !endingRef.current
    ) {
      void finishSession('watch');
    }
  }, [practiceSession, phase, finishSession]);

  const shotMarkers: ShotMarker[] = useMemo(
    () => shots.map((s, i) => ({ lng: s.land.lng, lat: s.land.lat, n: i + 1 })),
    [shots]
  );
  const summaries = useMemo(() => computeClubSummaries(shots), [shots]);

  // --- Phase A / denied (no map yet) --------------------------------------
  if (phase === 'locating' || phase === 'denied' || !origin) {
    return (
      <Box
        sx={{
          minHeight: '100dvh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          px: 3,
          pt: 'calc(env(safe-area-inset-top) + 16px)',
          pb: 'calc(env(safe-area-inset-bottom) + 16px)'
        }}
      >
        {phase === 'denied' ? (
          <Stack spacing={2} alignItems="center">
            <LocationOnRoundedIcon color="disabled" sx={{ fontSize: 48 }} />
            <Typography variant="h6">Location needed</Typography>
            <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
              We capture your mat position once to measure your shots. Enable location access and
              try again.
            </Typography>
            <Button variant="contained" onClick={captureOrigin}>
              Retry
            </Button>
            <Button onClick={() => navigate('/practice')}>Back</Button>
          </Stack>
        ) : (
          <Stack spacing={2} alignItems="center">
            <CircularProgress />
            <Typography color="text.secondary">Finding your position…</Typography>
          </Stack>
        )}
      </Box>
    );
  }

  // --- Phase B/C: map + overlays ------------------------------------------
  const instruction =
    phase === 'set-target'
      ? 'Tap your target/aim point down the range.'
      : pendingSwing
        ? 'Swing detected — tap where the ball landed.'
        : 'Tap where the ball landed.';

  return (
    <Box sx={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <RangeMap
        origin={origin}
        target={session ? session.target : null}
        bearing={session ? session.targetBearing : 0}
        shots={shotMarkers}
        showArcs={phase === 'logging'}
        onMapTap={handleTap}
      />

      {/* Top instruction bar */}
      <Box
        sx={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 8px)',
          left: 8,
          right: 8,
          display: 'flex',
          gap: 1,
          alignItems: 'center'
        }}
      >
        <Box
          sx={{
            flex: 1,
            bgcolor: 'rgba(0,0,0,0.6)',
            color: '#fff',
            borderRadius: 2,
            px: 1.5,
            py: 1
          }}
        >
          <Typography variant="body2" fontWeight={600}>
            {instruction}
          </Typography>
        </Box>
        <Button
          size="small"
          variant="contained"
          color="inherit"
          disabled={busy}
          onClick={onEnd}
          sx={{ bgcolor: 'rgba(0,0,0,0.6)', color: '#fff' }}
        >
          End
        </Button>
      </Box>

      {/* Bottom session bar */}
      {phase === 'logging' && (
        <Box
          sx={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 'calc(env(safe-area-inset-bottom) + 8px)',
            bgcolor: 'background.paper',
            borderRadius: 3,
            p: 1.5,
            boxShadow: 6,
            maxHeight: '45dvh',
            overflowY: 'auto'
          }}
        >
          {error && (
            <Alert severity="error" sx={{ mb: 1 }}>
              {error}
            </Alert>
          )}
          <Stack direction="row" spacing={1} alignItems="center">
            <Box sx={{ flex: 1 }}>
              <ClubSelector value={selectedClubId} onChange={setSelectedClubId} label="Club" />
            </Box>
            {lastChip && <Chip color="primary" label={lastChip} />}
          </Stack>

          <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mt: 1 }}>
            <Typography variant="caption" color="text.secondary">
              {shots.length} shot{shots.length === 1 ? '' : 's'} this session
            </Typography>
            {busy && <CircularProgress size={16} />}
          </Stack>

          {summaries.length > 0 && (
            <>
              <Divider sx={{ my: 1 }} />
              <Stack spacing={0.5}>
                {summaries.map((s) => (
                  <Stack key={s.club} direction="row" justifyContent="space-between">
                    <Typography variant="body2" fontWeight={600}>
                      {s.club}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {Math.round(s.avgCarryYards)}y avg · ±{Math.round(s.dispersionYards)}y ({s.shotCount})
                    </Typography>
                  </Stack>
                ))}
              </Stack>
            </>
          )}

          {import.meta.env.DEV && (
            <Button
              size="small"
              sx={{ mt: 1 }}
              onClick={() =>
                __devEmitSwing({ id: `dev_${Date.now()}`, club: clubLabel(selectedClubId) })
              }
            >
              Simulate swing (dev)
            </Button>
          )}
        </Box>
      )}

      {/* Phase B has no bottom bar; show transient errors centered-bottom */}
      {phase === 'set-target' && error && (
        <Alert
          severity="error"
          sx={{ position: 'absolute', left: 8, right: 8, bottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
        >
          {error}
        </Alert>
      )}
    </Box>
  );
}
