import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Button, CircularProgress, LinearProgress, Stack, Typography } from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded';
import UndoRoundedIcon from '@mui/icons-material/UndoRounded';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from '@/stores/authStore';
import { useBagStore } from '@/stores/bagStore';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { useDrillRunStore } from '@/stores/drillRunStore';
import { ensureGpsPermission, getCurrentPosition } from '@/services/gpsService';
import { rangeRepo } from '@/services/rangeRepo';
import { practiceController } from '@/features/practice/practiceController';
import { watchBridge } from '@/services/watchBridge';
import { offSwing, onSwing, resolveSwingEventId, type SwingEvent } from '@/services/rangeSwingBridge';
import { RangeMap, type ShotMarker, type TargetShape } from '@/features/range/RangeMap';
import { computeBearing, computeShot, destinationPoint, circleRing, mToYards, yardsToM } from '@/features/range/rangeGeo';
import { getDrill } from '@/features/range/drills/registry';
import { bagToDrillClubs } from '@/features/range/drills/fromBag';
import type { DrillContext, DrillState, RawShot, ShotResult, ShotZone } from '@/features/range/drills/types';
import type { LatLng, RangeSession } from '@/types/range';

type Phase = 'locating' | 'denied' | 'running';

// Right-side HUD stat card — theme surface, slightly transparent (matches range).
const hudCardSx = {
  bgcolor: (t: import('@mui/material').Theme) => alpha(t.palette.background.paper, 0.72),
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  borderRadius: '5px',
  px: 1.5,
  py: 1,
  minWidth: 84,
  color: 'text.primary',
  textAlign: 'center' as const
};

// Zone → theme color token for the landing dot + feedback chip.
function zoneColor(zone: ShotZone): 'success' | 'warning' | 'error' | 'primary' {
  if (zone === 'great') return 'success';
  if (zone === 'good') return 'warning';
  if (zone === 'miss') return 'error';
  return 'primary';
}

export function DrillRunnerPage() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const bag = useBagStore((s) => s.clubs);
  const swings = useSwingSessionStore((s) => s.swings);
  const selection = useDrillRunStore((s) => s.selection);

  const definition = useMemo(() => getDrill(selection?.drillId), [selection?.drillId]);
  const drillClubs = useMemo(() => bagToDrillClubs(bag), [bag]);
  // Stable per-run context (seed fixed at mount so the rotation is reproducible).
  const ctxRef = useRef<DrillContext | null>(null);
  if (!ctxRef.current && selection && definition) {
    ctxRef.current = { bag: drillClubs, config: { ...selection.config, seed: Date.now() & 0xffffffff } };
  }
  const ctx = ctxRef.current;

  const [phase, setPhase] = useState<Phase>('locating');
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [aimBearing, setAimBearing] = useState(0);
  const [drillState, setDrillState] = useState<DrillState | null>(null);
  const [session, setSession] = useState<RangeSession | null>(null);
  const [feedback, setFeedback] = useState<ShotResult | null>(null);
  const [mapShots, setMapShots] = useState<Array<{ land: LatLng; zone: ShotZone }>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Raw shots + DB ids kept for Undo (replays the engine from init).
  const rawHistory = useRef<RawShot[]>([]);
  const shotIds = useRef<string[]>([]);
  // Watch-swing seam: a detected swing drives the next tap's swing_event_id link.
  const pendingSwingRef = useRef<SwingEvent | null>(null);

  // Live watch-swing stats (same math as the free-play range HUD).
  const tempos = swings
    .map((s) => s.tempoRatio)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const avgTempo = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
  let consistency: number | null = null;
  if (tempos.length >= 2) {
    const m = tempos.reduce((a, b) => a + b, 0) / tempos.length;
    const variance = tempos.reduce((a, b) => a + (b - m) ** 2, 0) / tempos.length;
    const cv = m ? Math.sqrt(variance) / m : 0;
    consistency = Math.max(0, Math.min(100, Math.round(100 * (1 - cv * 3))));
  }

  // --- capture mat origin once, then init the drill -----------------------
  const captureOrigin = useCallback(async () => {
    setPhase('locating');
    setError(null);
    try {
      await ensureGpsPermission();
      const pt = await getCurrentPosition({ enableHighAccuracy: true });
      setOrigin({ lat: pt.lat, lng: pt.lng });
      setPhase('running');
    } catch (err) {
      console.warn('[drill] location failed', err);
      setPhase('denied');
    }
  }, []);

  useEffect(() => {
    if (!selection || !definition) {
      navigate('/drills', { replace: true });
      return;
    }
    void captureOrigin();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize the engine once we have an origin + context.
  useEffect(() => {
    if (origin && ctx && definition && !drillState) {
      setDrillState(definition.init(ctx));
    }
  }, [origin, ctx, definition, drillState]);

  const current = drillState?.current ?? null;
  const usesTargets = ctx && definition ? definition.usesTargets(ctx.config) : false;
  // The aim handle sits on the called distance (or 250 yd straight when no target).
  const aimDistanceYds = usesTargets && current?.targetYards ? current.targetYards : 250;
  const aimPoint = origin ? destinationPoint(origin, aimBearing, yardsToM(aimDistanceYds)) : null;

  // --- watch practice: track tempo/consistency during the drill -----------
  // Tagged source='range' so drill runs stay out of the Swing/Net history.
  // Swings flow in via the root usePracticeWatchSync. Native-only.
  const watchStartedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'running' || watchStartedRef.current) return;
    if (!Capacitor.isNativePlatform()) return;
    watchStartedRef.current = true;
    void (async () => {
      const status = await watchBridge.activate();
      const installed = 'isWatchAppInstalled' in status && Boolean(status.isWatchAppInstalled);
      if (!installed) return;
      void practiceController.start(current?.club ?? null, 'range');
      void watchBridge.launchWatch(true);
    })();
  }, [phase, current?.club]);

  // Keep the watch session's club in sync with the prescribed club.
  useEffect(() => {
    if (phase === 'running') practiceController.setClub(current?.club ?? null);
  }, [current?.club, phase]);

  // Register the swing handler (a detected swing pre-fills the next tap's link).
  useEffect(() => {
    onSwing((e) => {
      pendingSwingRef.current = e;
    });
    return () => offSwing();
  }, []);

  // End the watch session (idempotent enough for our two end paths).
  const endWatch = useCallback(async () => {
    try {
      void watchBridge.endWatchPractice();
      if (useSwingSessionStore.getState().session) {
        await practiceController.end();
      }
    } catch (err) {
      console.warn('[drill] ending watch practice failed', err);
    }
  }, []);

  // --- log a shot ---------------------------------------------------------
  const handleTap = useCallback(
    async (land: LatLng) => {
      if (busy || phase !== 'running' || !origin || !userId || !definition || !ctx || !drillState || !current || !aimPoint)
        return;
      setBusy(true);
      setError(null);
      try {
        const d = computeShot(origin, aimPoint, land);
        const raw: RawShot = {
          carryYards: mToYards(d.carryM),
          offlineYards: mToYards(d.offlineM),
          totalYards: mToYards(d.totalM),
          club: null
        };
        // Lazily open the drill session on the first shot.
        let activeSession = session;
        if (!activeSession) {
          activeSession = await rangeRepo.createSession(userId, origin, aimPoint, {
            drillId: definition.id,
            drillConfig: ctx.config
          });
          setSession(activeSession);
        }
        const { result, nextState } = definition.onShot(raw, drillState, ctx);
        // Link a real (persisted) watch swing if one was detected before this tap.
        const swing = pendingSwingRef.current;
        const swingEventId = swing ? resolveSwingEventId(swing.id) : null;
        pendingSwingRef.current = null;
        const shot = await rangeRepo.logShot({
          session: activeSession,
          land,
          aim: aimPoint,
          club: current.club,
          prescribedClub: current.club,
          targetYards: current.targetYards,
          proximityM: result.proximityYards != null ? yardsToM(result.proximityYards) : null,
          swingEventId
        });
        rawHistory.current.push(raw);
        shotIds.current.push(shot.id);
        setMapShots((prev) => [...prev, { land, zone: result.zone }]);
        setFeedback(result);
        setDrillState(nextState);

        if (definition.isComplete(nextState)) {
          await endWatch();
          await rangeRepo.endSession(activeSession.id);
          navigate(`/drills/report/${activeSession.id}`, { replace: true });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not log shot');
      } finally {
        setBusy(false);
      }
    },
    [busy, phase, origin, userId, definition, ctx, drillState, current, aimPoint, session, navigate, endWatch]
  );

  // --- undo last shot (delete in DB, replay engine from init) -------------
  const undo = useCallback(async () => {
    if (!definition || !ctx || rawHistory.current.length === 0) return;
    const id = shotIds.current.pop();
    rawHistory.current.pop();
    if (id) {
      try {
        await rangeRepo.deleteShot(id);
      } catch (err) {
        console.warn('[drill] undo delete failed', err);
      }
    }
    let st = definition.init(ctx);
    for (const raw of rawHistory.current) st = definition.onShot(raw, st, ctx).nextState;
    setDrillState(st);
    setMapShots((prev) => prev.slice(0, -1));
    setFeedback(null);
  }, [definition, ctx]);

  // --- end early → report (or bail if nothing logged) ---------------------
  const endingRef = useRef(false);
  const endDrill = useCallback(async () => {
    if (endingRef.current) return;
    if (!session) {
      await endWatch();
      navigate('/drills', { replace: true });
      return;
    }
    endingRef.current = true;
    setBusy(true);
    try {
      await endWatch();
      await rangeRepo.endSession(session.id);
      navigate(`/drills/report/${session.id}`, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end drill');
      setBusy(false);
      endingRef.current = false;
    }
  }, [session, navigate, endWatch]);

  // --- map data -----------------------------------------------------------
  const theme = useThemeColors();
  const shotMarkers: ShotMarker[] = useMemo(
    () => mapShots.map((s, i) => ({ lng: s.land.lng, lat: s.land.lat, n: i + 1, color: theme[zoneColor(s.zone)] })),
    [mapShots, theme]
  );
  // Proximity drills draw great + good rings around the intended point.
  const rings: TargetShape[] = useMemo(() => {
    if (!usesTargets || !aimPoint || !current?.targetYards) return [];
    const t = current.targetYards;
    return [
      { id: 'good', ring: circleRing(aimPoint, yardsToM(0.12 * t)), label: '', selected: false },
      { id: 'great', ring: circleRing(aimPoint, yardsToM(0.05 * t)), label: '', selected: true }
    ];
  }, [usesTargets, aimPoint, current?.targetYards]);

  // --- gates --------------------------------------------------------------
  if (!selection || !definition) return null;

  if (drillClubs.length === 0) {
    return (
      <CenterMsg
        title="Set up your bag first"
        body="Drills call clubs from your bag. Add your clubs, then start a drill."
        actionLabel="Go to onboarding"
        onAction={() => navigate('/onboarding')}
        onBack={() => navigate('/drills')}
      />
    );
  }

  if (phase === 'locating' || phase === 'denied' || !origin) {
    return phase === 'denied' ? (
      <CenterMsg
        title="Location needed"
        body="We capture your mat position once to measure your shots. Enable location access and try again."
        actionLabel="Retry"
        onAction={captureOrigin}
        onBack={() => navigate('/drills')}
      />
    ) : (
      <Box sx={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Stack spacing={2} alignItems="center">
          <CircularProgress />
          <Typography color="text.secondary">Finding your position…</Typography>
        </Stack>
      </Box>
    );
  }

  const progress = current ? (current.shotNumber - 1) / current.totalShots : 1;

  return (
    <Box sx={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <RangeMap
        origin={origin}
        target={aimPoint}
        bearing={aimBearing}
        shots={shotMarkers}
        showArcs={!usesTargets}
        targets={rings}
        aimDraggable
        onAimChange={(p) => setAimBearing(computeBearing(origin, p))}
        onMapTap={handleTap}
      />

      {/* Caddie card — the prominent instruction banner. */}
      <Box
        sx={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 8px)',
          left: 8,
          right: 8,
          borderRadius: '12px',
          px: 2,
          py: 1.5,
          bgcolor: (t) => alpha(t.palette.background.paper, 0.92),
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          boxShadow: 6
        }}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 0.5 }}>
          <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.5, color: 'text.secondary' }}>
            {definition.name.toUpperCase()}
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
            {current ? `Shot ${current.shotNumber} of ${current.totalShots}` : 'Complete'}
          </Typography>
        </Stack>
        {current ? (
          <Stack direction="row" alignItems="baseline" spacing={1}>
            <Typography sx={{ fontWeight: 900, fontSize: '1.6rem', lineHeight: 1.05 }}>
              {current.club ?? 'Any club'}
            </Typography>
            {current.targetYards != null && (
              <Typography sx={{ fontWeight: 700, color: 'primary.main' }}>→ {current.targetYards} yds</Typography>
            )}
          </Stack>
        ) : (
          <Typography sx={{ fontWeight: 800 }}>Finishing…</Typography>
        )}
        <LinearProgress
          variant="determinate"
          value={Math.min(100, Math.round(progress * 100))}
          sx={{ mt: 1, height: 6, borderRadius: 999 }}
        />
      </Box>

      {/* Per-shot feedback chip — color-coded by zone, with a caddie note. */}
      {feedback && (
        <Box
          sx={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 120px)',
            left: '50%',
            transform: 'translateX(-50%)',
            px: 2,
            py: 1,
            borderRadius: 999,
            color: '#fff',
            bgcolor: (t) => t.palette[zoneColor(feedback.zone)].main,
            boxShadow: 4,
            maxWidth: '90%'
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 800, textAlign: 'center' }} noWrap>
            {feedback.proximityYards != null
              ? `${Math.round(feedback.proximityYards)}y away · ${feedback.note}`
              : feedback.note}
          </Typography>
        </Box>
      )}

      {/* Live watch stats — Avg Tempo + Consistency (same as free-play range). */}
      <Stack
        spacing={1}
        sx={{
          position: 'absolute',
          right: 8,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 4
        }}
      >
        <Box sx={hudCardSx}>
          <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', lineHeight: 1 }}>
            {avgTempo != null ? `${avgTempo.toFixed(1)}:1` : '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Avg Tempo
          </Typography>
        </Box>
        <Box sx={hudCardSx}>
          <Typography sx={{ fontWeight: 800, fontSize: '1.25rem', lineHeight: 1 }}>
            {consistency != null ? consistency : '—'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Consistency
          </Typography>
        </Box>
      </Stack>

      {/* Thumb-reachable controls. */}
      <Stack
        direction="row"
        spacing={1.5}
        sx={{
          position: 'absolute',
          left: 16,
          right: 16,
          bottom: 'calc(env(safe-area-inset-bottom) + 16px)',
          justifyContent: 'space-between'
        }}
      >
        <Button
          variant="contained"
          color="inherit"
          startIcon={<UndoRoundedIcon />}
          disabled={busy || mapShots.length === 0}
          onClick={undo}
          sx={{ bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' } }}
        >
          Undo
        </Button>
        <Button
          variant="contained"
          color="inherit"
          disabled={busy}
          onClick={endDrill}
          sx={{ bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' } }}
        >
          {current ? 'End drill' : 'See report'}
        </Button>
      </Stack>

      {error && (
        <Box
          sx={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 'calc(env(safe-area-inset-bottom) + 76px)',
            bgcolor: 'error.main',
            color: '#fff',
            borderRadius: 1,
            px: 1.5,
            py: 1
          }}
        >
          <Typography variant="body2">{error}</Typography>
        </Box>
      )}
    </Box>
  );
}

// Resolve the few theme palette mains we need as hex (for the data-driven map dots).
function useThemeColors() {
  const t = useTheme();
  return {
    success: t.palette.success.main,
    warning: t.palette.warning.main,
    error: t.palette.error.main,
    primary: t.palette.primary.main
  };
}

function CenterMsg({
  title,
  body,
  actionLabel,
  onAction,
  onBack
}: {
  title: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
  onBack: () => void;
}) {
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
        gap: 2
      }}
    >
      <LocationOnRoundedIcon color="disabled" sx={{ fontSize: 48 }} />
      <Typography variant="h6">{title}</Typography>
      <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 320 }}>
        {body}
      </Typography>
      <Button variant="contained" onClick={onAction}>
        {actionLabel}
      </Button>
      <Button onClick={onBack}>Back</Button>
    </Box>
  );
}
