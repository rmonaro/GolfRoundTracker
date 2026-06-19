import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  Drawer,
  IconButton,
  Slide,
  Slider,
  Stack,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material';
import LocationOnRoundedIcon from '@mui/icons-material/LocationOnRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { TargetIcon } from '@/components/icons/TargetIcon';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import ExploreRoundedIcon from '@mui/icons-material/ExploreRounded';
import LockRoundedIcon from '@mui/icons-material/LockRounded';
import { useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { useAuthStore } from '@/stores/authStore';
import { useBagStore } from '@/stores/bagStore';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { ClubPicker, type ClubTier1 } from '@/features/round/AddShotSheet';
import { abbreviateClubName } from '@/features/bag/abbreviateClubName';
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
import { targetCenter } from '@/services/rangeRepo';
import { WindIndicator } from '@/components/ui/WindIndicator';
import { useWind } from '@/hooks/useWind';
import { RangeMap, type ShotMarker, type TargetShape } from '@/features/range/RangeMap';
import { RangeTour } from './RangeTour';
import { classifyShotVsTarget, clubColor, shotChipLabel } from '@/features/range/rangeStats';
import {
  circleRing,
  computeBearing,
  destinationPoint,
  haversineMeters,
  pointInPolygon,
  yardsToM
} from '@/features/range/rangeGeo';
import type { LatLng, RangeSession, RangeShot, RangeTarget } from '@/types/range';

type Phase = 'locating' | 'denied' | 'logging';

// Right-side HUD stat card — theme surface, slightly transparent.
const hudCardSx: SxProps<Theme> = {
  bgcolor: (theme) => alpha(theme.palette.background.paper, 0.72),
  backdropFilter: 'blur(6px)',
  WebkitBackdropFilter: 'blur(6px)',
  borderRadius: '5px',
  px: 1.5,
  py: 1,
  minWidth: 88,
  color: 'text.primary',
  textAlign: 'center'
};

export function RangeSessionPage() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const bag = useBagStore((s) => s.clubs);
  const swings = useSwingSessionStore((s) => s.swings);

  const [phase, setPhase] = useState<Phase>('locating');
  const [origin, setOrigin] = useState<LatLng | null>(null);
  const [session, setSession] = useState<RangeSession | null>(null);
  const [shots, setShots] = useState<RangeShot[]>([]);
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [selectedClubTier1, setSelectedClubTier1] = useState<ClubTier1 | null>(null);
  const [clubPickerOpen, setClubPickerOpen] = useState(false);
  const [lastChip, setLastChip] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Select a club" hint when tapping with no club chosen.
  const [clubHint, setClubHint] = useState(false);
  // Top instruction banner slides in from the left, then auto-hides.
  const [showInstruction, setShowInstruction] = useState(true);
  // Guided overlay tour — auto-shows once, replayable from the "?" button.
  const TOUR_KEY = 'grt.range.tour.v1';
  const [tourOpen, setTourOpen] = useState(false);
  const [shotsDrawerOpen, setShotsDrawerOpen] = useState(false);
  const [shotsTab, setShotsTab] = useState<string | null>(null);

  // Aim targets (greens/spots drawn on the range).
  const [targets, setTargets] = useState<RangeTarget[]>([]);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [targetsDrawerOpen, setTargetsDrawerOpen] = useState(false);
  const [drawMode, setDrawMode] = useState<'none' | 'circle' | 'polygon'>('none');
  const [draftCenter, setDraftCenter] = useState<LatLng | null>(null);
  const [draftRadiusYd, setDraftRadiusYd] = useState(12);
  const [draftPoints, setDraftPoints] = useState<LatLng[]>([]);

  // Down-range aim direction: dragged by the user. This drives the aim LINE
  // only — it no longer rotates the map once the range orientation is locked.
  // null → fall back to the session's bearing, else straight up (north).
  const [manualBearing, setManualBearing] = useState<number | null>(null);
  // The exact point the user dragged the aim to (lat/lng). Holds both direction
  // AND distance so the aim stays where dropped instead of snapping to a fixed
  // down-range distance. null → fall back to the default 250-yd aim line.
  const [manualAim, setManualAim] = useState<LatLng | null>(null);
  // The locked orientation of the range (which way is "up" on the map). Set when
  // the user locks the direction (or it's restored for this mat). Decoupled from
  // the aim so moving the aim never re-rotates the map.
  const [orientationBearing, setOrientationBearing] = useState<number | null>(null);
  const [aimLocked, setAimLocked] = useState(false);
  const [aimDirty, setAimDirty] = useState(false);

  const aimTarget = selectedTargetId ? targets.find((t) => t.id === selectedTargetId) ?? null : null;

  // Hit-test a point against saved targets so dragging the aim back onto a
  // target re-selects it (snapping the aim to its center) without opening the
  // targets drawer. Circles use a radius check; polygons a point-in-polygon.
  const targetAtPoint = useCallback(
    (p: LatLng): RangeTarget | null => {
      for (const t of targets) {
        if (t.kind === 'circle' && t.center) {
          if (haversineMeters(p, t.center) <= (t.radiusM ?? yardsToM(12))) return t;
        } else if (t.kind === 'polygon' && t.points && t.points.length >= 3) {
          if (pointInPolygon(p, t.points)) return t;
        }
      }
      return null;
    },
    [targets]
  );

  // Live wind at the mat, resolved against the down-range aim line so the HUD
  // reads head/tail/cross the same way the round does.
  const windAimBearing =
    manualBearing != null ? manualBearing : session ? session.targetBearing : null;
  const { wind, relative: windRelative } = useWind(origin?.lat, origin?.lng, windAimBearing);

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

  const selectedClubObj = selectedClubId
    ? bag.find((c) => c.clubId === selectedClubId) ?? null
    : null;

  // Live watch-swing stats for the right-side HUD (same as Swing/Net).
  const tempos = swings
    .map((s) => s.tempoRatio)
    .filter((v): v is number => typeof v === 'number' && !Number.isNaN(v));
  const avgTempo = tempos.length ? tempos.reduce((a, b) => a + b, 0) / tempos.length : null;
  let consistency: number | null = null;
  if (tempos.length >= 2) {
    const mean = tempos.reduce((a, b) => a + b, 0) / tempos.length;
    const variance = tempos.reduce((a, b) => a + (b - mean) ** 2, 0) / tempos.length;
    const cv = mean ? Math.sqrt(variance) / mean : 0;
    consistency = Math.max(0, Math.min(100, Math.round(100 * (1 - cv * 3))));
  }

  // --- Phase A: capture origin once (or restore an open session) ----------
  // The aim line is auto-set straight up the range, so the user logs shots
  // immediately — no separate target-setting tap, no reframe on first tap.
  const captureOrigin = useCallback(async () => {
    setPhase('locating');
    setError(null);
    try {
      await ensureGpsPermission();
      const pt = await getCurrentPosition({ enableHighAccuracy: true });
      setOrigin({ lat: pt.lat, lng: pt.lng });
      setPhase('logging');
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

  // Load saved targets near this mat (reuse across sessions at the same range).
  useEffect(() => {
    if (!origin || !userId) return;
    let cancelled = false;
    rangeRepo
      .listTargetsNear(userId, origin)
      .then((t) => {
        if (!cancelled) setTargets(t);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [origin?.lat, origin?.lng, userId]);

  // Restore the remembered down-range aim direction for this mat, if any.
  useEffect(() => {
    if (!origin || !userId) return;
    let cancelled = false;
    rangeRepo
      .getOrientationNear(userId, origin)
      .then((o) => {
        if (!cancelled && o) {
          setOrientationBearing(o.bearing);
          setManualBearing(o.bearing);
          setAimLocked(true);
          setAimDirty(false);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [origin?.lat, origin?.lng, userId]);

  const cancelDraw = useCallback(() => {
    setDrawMode('none');
    setDraftCenter(null);
    setDraftPoints([]);
  }, []);

  const saveTarget = useCallback(async () => {
    if (!origin || !userId) return;
    try {
      let created: RangeTarget | null = null;
      if (drawMode === 'circle' && draftCenter) {
        created = await rangeRepo.createTarget(userId, origin, {
          kind: 'circle',
          center: draftCenter,
          radiusM: yardsToM(draftRadiusYd)
        });
      } else if (drawMode === 'polygon' && draftPoints.length >= 3) {
        created = await rangeRepo.createTarget(userId, origin, { kind: 'polygon', points: draftPoints });
      }
      if (created) {
        setTargets((prev) => [...prev, created as RangeTarget]);
        setSelectedTargetId(created.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save target');
    } finally {
      cancelDraw();
    }
  }, [origin, userId, drawMode, draftCenter, draftRadiusYd, draftPoints, cancelDraw]);

  const removeTarget = useCallback(
    async (id: string) => {
      try {
        await rangeRepo.deleteTarget(id);
        setTargets((prev) => prev.filter((t) => t.id !== id));
        setSelectedTargetId((cur) => (cur === id ? null : cur));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not delete target');
      }
    },
    []
  );

  // Persist the current down-range aim direction for this mat (reload on return).
  const lockAim = useCallback(async () => {
    if (!origin || !userId) return;
    const bearing = manualBearing != null ? manualBearing : session ? session.targetBearing : 0;
    try {
      await rangeRepo.saveOrientation(userId, origin, bearing);
      // Lock this as the map orientation; the aim starts pointing straight up
      // the range and can then be dragged freely without rotating the map.
      setOrientationBearing(bearing);
      setManualBearing(bearing);
      setAimLocked(true);
      setAimDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save aim direction');
    }
  }, [origin, userId, manualBearing, session]);

  // --- Watch practice: track tempo/consistency during the range session ----
  // Started tagged source='range' so it stays out of the Swing/Net history.
  // Swings flow in via the root usePracticeWatchSync. Native-only.
  const watchStartedRef = useRef(false);
  useEffect(() => {
    if (phase !== 'logging' || watchStartedRef.current) return;
    if (!Capacitor.isNativePlatform()) return;
    watchStartedRef.current = true;
    void (async () => {
      // Only track via the watch when its companion app is actually installed —
      // otherwise WCSession can't deliver the startPractice command and we'd
      // create an empty session that never receives swings.
      const status = await watchBridge.activate();
      const installed = 'isWatchAppInstalled' in status && Boolean(status.isWatchAppInstalled);
      if (!installed) return;
      // Open the phone session first so it exists when the watch connects back,
      // then launch the watch straight into practice mode.
      void practiceController.start(selectedClubId, 'range');
      void watchBridge.launchWatch(true);
    })();
  }, [phase, selectedClubId]);

  // Keep the watch session's club in sync with the range club selector.
  useEffect(() => {
    if (phase === 'logging') practiceController.setClub(selectedClubId);
  }, [selectedClubId, phase]);

  // Slide the instruction banner in (from the left), then hide it. Re-shows when
  // the instruction context changes (phase, drawing mode, a detected swing).
  useEffect(() => {
    setShowInstruction(true);
    const t = setTimeout(() => setShowInstruction(false), 3200);
    return () => clearTimeout(t);
  }, [phase, drawMode, draftCenter, pendingSwing]);

  // Auto-show the guided tour the first time the map is reached.
  useEffect(() => {
    if (phase !== 'logging') return;
    try {
      if (localStorage.getItem(TOUR_KEY) !== 'done') setTourOpen(true);
    } catch {
      /* localStorage unavailable — skip the auto-tour */
    }
  }, [phase]);

  const closeTour = useCallback(() => {
    setTourOpen(false);
    try {
      localStorage.setItem(TOUR_KEY, 'done');
    } catch {
      /* ignore */
    }
  }, []);

  // --- taps ---------------------------------------------------------------
  const handleTap = useCallback(
    async (p: LatLng) => {
      // Drawing modes consume taps as geometry, not shots.
      if (drawMode === 'circle') {
        setDraftCenter(p);
        return;
      }
      if (drawMode === 'polygon') {
        setDraftPoints((prev) => [...prev, p]);
        return;
      }
      if (busy || phase !== 'logging' || !origin || !userId) return;
      // Require a club before logging a shot.
      if (!selectedClubId) {
        setClubHint(true);
        return;
      }
      setBusy(true);
      setError(null);
      setClubHint(false);
      try {
        // Current aim: the selected target wins (so re-aiming mid-session works),
        // else the user's chosen/locked direction (or the session's saved bearing).
        let activeSession = session;
        const baseBearing =
          manualBearing != null ? manualBearing : activeSession ? activeSession.targetBearing : 0;
        const aim = aimTarget
          ? targetCenter(aimTarget)
          : destinationPoint(origin, baseBearing, yardsToM(250));
        // Lazily open the session on the first shot.
        if (!activeSession) {
          activeSession = await rangeRepo.createSession(userId, origin, aim);
          setSession(activeSession);
        }
        // A pending swing event (from the watch bridge) wins over the manual
        // club selector and supplies the swing_event_id.
        const swing = pendingSwingRef.current;
        const club = swing?.club ?? clubLabel(selectedClubId);
        // Only link a real (persisted) swing_metrics uuid; null otherwise.
        const swingEventId = swing ? resolveSwingEventId(swing.id) : null;
        const shot = await rangeRepo.logShot({
          session: activeSession,
          land: p,
          club,
          swingEventId,
          aim,
          targetId: aimTarget?.id ?? null
        });
        setShots((prev) => [...prev, shot]);
        // When aimed at a target, report the result vs the target; else the
        // straight carry/offline relative to the range line.
        setLastChip(
          aimTarget
            ? `${Math.round(shot.totalYards)} yds · ${classifyShotVsTarget(origin, aimTarget, p).label}`
            : shotChipLabel(shot.totalYards, shot.offlineYards)
        );
        pendingSwingRef.current = null;
        setPendingSwing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not log shot');
      } finally {
        setBusy(false);
      }
    },
    [drawMode, busy, phase, origin, userId, session, aimTarget, manualBearing, selectedClubId, clubLabel]
  );

  // End the range session (idempotent) and go to the summary.
  const endingRef = useRef(false);
  const onEnd = useCallback(async () => {
    if (!session) {
      navigate('/practice');
      return;
    }
    if (endingRef.current) return;
    endingRef.current = true;
    setBusy(true);
    try {
      // Finalize the watch session too (stop the watch + persist rollups).
      void watchBridge.endWatchPractice();
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
  }, [session, navigate]);

  const shotMarkers: ShotMarker[] = useMemo(
    () => shots.map((s, i) => ({ lng: s.land.lng, lat: s.land.lat, n: i + 1, color: clubColor(s.club) })),
    [shots]
  );
  const lastShotYards = shots.length ? Math.round(shots[shots.length - 1].totalYards) : null;
  // Float the bottom controls above the summary card when it's showing.
  const controlsBottomPx = shots.length > 0 ? 96 : 16;

  // Running summary for the most-recently-hit club — the single bottom card.
  const currentClub = shots.length ? shots[shots.length - 1].club ?? null : null;
  const clubShots = shots.length ? shots.filter((s) => (s.club ?? null) === currentClub) : [];
  const clubSummary = clubShots.length
    ? (() => {
        const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
        const offlines = clubShots.map((s) => s.offlineYards);
        const m = mean(offlines);
        return {
          count: clubShots.length,
          avgCarry: mean(clubShots.map((s) => s.carryYards)),
          dispersion: Math.sqrt(offlines.reduce((a, b) => a + (b - m) ** 2, 0) / offlines.length)
        };
      })()
    : null;

  const deleteShot = async (id: string) => {
    try {
      await rangeRepo.deleteShot(id);
      setShots((prev) => prev.filter((s) => s.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete shot');
    }
  };

  // Group shots by club for the drawer tabs (keeps each club's shots together).
  const clubKeys: string[] = [];
  for (const s of shots) {
    const k = s.club ?? 'No club';
    if (!clubKeys.includes(k)) clubKeys.push(k);
  }
  const effectiveTab = shotsTab && clubKeys.includes(shotsTab) ? shotsTab : clubKeys[0] ?? false;
  const tabShots = shots
    .map((s, i) => ({ shot: s, n: i + 1 }))
    .filter(({ shot }) => (shot.club ?? 'No club') === effectiveTab);

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
    drawMode === 'circle'
      ? draftCenter
        ? 'Adjust the radius, then save.'
        : 'Tap the center of the green.'
      : drawMode === 'polygon'
        ? 'Tap around the green, then finish.'
        : pendingSwing
          ? 'Swing detected — tap where the ball landed.'
          : 'Tap where the ball landed.';

  // Aim point/bearing: a selected target always wins (so switching targets
  // re-aims mid-session). Otherwise the aim points down the user's chosen/locked
  // direction (else the session's saved bearing, else straight up the range).
  const freeBearing = manualBearing != null ? manualBearing : session ? session.targetBearing : 0;
  const aimPoint: LatLng = aimTarget
    ? targetCenter(aimTarget)
    : manualAim ?? destinationPoint(origin, freeBearing, yardsToM(250));
  const aimBearing = computeBearing(origin, aimPoint);

  // Map orientation is independent of the aim. Once the range direction is
  // locked, the map stays fixed at that orientation no matter where the aim
  // points — so the user can re-aim freely without the world spinning. Before
  // locking (or while re-orienting via the "Aim locked" chip → aimDirty) the
  // map follows the dragged aim so they can square it up to the real range.
  const orientationActive = aimLocked && !aimDirty && orientationBearing != null;
  const mapBearing = orientationActive ? (orientationBearing as number) : aimBearing;

  const targetShapes: TargetShape[] = targets.map((t) => ({
    id: t.id,
    ring:
      t.kind === 'circle' && t.center
        ? circleRing(t.center, t.radiusM ?? yardsToM(12))
        : (t.points ?? []).map((p) => [p.lng, p.lat] as [number, number]),
    label: t.label,
    selected: t.id === selectedTargetId
  }));

  const draftRing: [number, number][] | null =
    drawMode === 'circle' && draftCenter
      ? circleRing(draftCenter, yardsToM(draftRadiusYd))
      : drawMode === 'polygon' && draftPoints.length
        ? draftPoints.map((p) => [p.lng, p.lat] as [number, number])
        : null;

  return (
    <Box sx={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <RangeMap
        origin={origin}
        target={aimPoint}
        bearing={mapBearing}
        shots={shotMarkers}
        showArcs
        bottomBar={phase === 'logging' && drawMode === 'none'}
        targets={targetShapes}
        draftRing={draftRing}
        drawing={drawMode !== 'none'}
        // The aim line is ALWAYS freely draggable while logging — including
        // after locking a direction and when a target is selected. Dragging
        // breaks away from a target into free aim (re-select it to aim again).
        // Once the orientation is locked, dragging the aim moves only the line —
        // the map keeps its locked orientation (re-orient via the "Aim locked"
        // chip). Before locking, dragging both aims and squares up the map.
        aimDraggable={drawMode === 'none'}
        onAimChange={(p) => {
          // Keep the aim exactly where dropped (direction + distance); also track
          // the bearing for orientation (pre-lock) and the wind readout.
          setManualAim(p);
          setManualBearing(computeBearing(origin, p));
          // If dropped onto an existing target, re-select it (aim snaps to its
          // center) — no need to open the targets drawer. Otherwise free-aim.
          const hit = targetAtPoint(p);
          setSelectedTargetId(hit ? hit.id : null);
          // Keep the locked orientation — only mark "dirty" (re-orienting) when
          // nothing is locked yet, which just toggles the lock button's label.
          if (!aimLocked) setAimDirty(true);
        }}
        onMapTap={handleTap}
      />

      {/* Top-right controls */}
      <Box
        sx={{
          position: 'absolute',
          top: 'calc(env(safe-area-inset-top) + 8px)',
          right: 8,
          zIndex: 5,
          display: 'flex',
          gap: 1,
          alignItems: 'flex-start'
        }}
      >
        {drawMode === 'none' && (
          <IconButton
            aria-label="How the range works"
            onClick={() => setTourOpen(true)}
            sx={{ bgcolor: 'rgba(0,0,0,0.6)', color: '#fff', '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' } }}
          >
            <HelpOutlineRoundedIcon fontSize="small" />
          </IconButton>
        )}
        <Button
          size="small"
          variant="contained"
          color="primary"
          disabled={busy}
          onClick={drawMode === 'none' ? onEnd : cancelDraw}
          sx={{ borderRadius: '5px' }}
        >
          {drawMode === 'none' ? 'End' : 'Cancel'}
        </Button>
      </Box>

      {/* Top-left — live wind, relative to the down-range aim line. */}
      {phase === 'logging' && origin && (
        <Box
          sx={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 8px)',
            left: 8,
            zIndex: 5
          }}
        >
          <WindIndicator wind={wind} relative={windRelative} tone="surface" circle />
        </Box>
      )}

      {/* Aim-direction control — drag the marker to point down the range, then lock. */}
      {phase === 'logging' && drawMode === 'none' && !aimTarget && (
        <Box
          sx={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 58px)',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 5
          }}
        >
          {aimLocked && !aimDirty ? (
            <Chip
              size="small"
              icon={<LockRoundedIcon />}
              label="Aim locked"
              onClick={() => setAimDirty(true)}
              sx={{
                bgcolor: 'rgba(0,0,0,0.6)',
                color: '#fff',
                fontWeight: 700,
                '& .MuiChip-icon': { color: '#fff' }
              }}
            />
          ) : (
            <Button
              size="small"
              variant="contained"
              color="primary"
              startIcon={aimDirty ? <LockRoundedIcon /> : <ExploreRoundedIcon />}
              onClick={lockAim}
              sx={{ borderRadius: '5px' }}
            >
              {aimDirty ? 'Lock this direction' : 'Lock aim direction'}
            </Button>
          )}
        </Box>
      )}

      {/* Instruction banner — theme blue, centered up top, slides down then hides. */}
      <Slide direction="down" in={showInstruction} mountOnEnter unmountOnExit>
        <Box
          sx={{
            position: 'absolute',
            top: 'calc(env(safe-area-inset-top) + 8px)',
            left: 0,
            right: 0,
            mx: 'auto',
            width: 'fit-content',
            maxWidth: '70%',
            zIndex: 4,
            bgcolor: 'info.main',
            color: 'info.contrastText',
            borderRadius: 2,
            px: 1.5,
            py: 1,
            boxShadow: 4,
            textAlign: 'center'
          }}
        >
          <Typography variant="body2" fontWeight={700}>
            {instruction}
          </Typography>
        </Box>
      </Slide>

      {/* Club selection — always present from load, just the circle. */}
      {drawMode === 'none' && (
      <Button
        onClick={() => {
          setClubHint(false);
          setClubPickerOpen(true);
        }}
        sx={{
          position: 'absolute',
          bottom: `calc(env(safe-area-inset-bottom) + ${controlsBottomPx}px)`,
          left: 16,
          zIndex: 4,
          width: 56,
          height: 56,
          minWidth: 56,
          borderRadius: '50%',
          p: 0,
          bgcolor: (theme) => alpha(theme.palette.info.main, 0.85),
          color: 'info.contrastText',
          border: 2,
          borderColor: selectedClubObj ? 'primary.main' : 'rgba(255,255,255,0.55)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          fontWeight: 800,
          fontSize: '0.95rem',
          lineHeight: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          '&:hover': { bgcolor: (theme) => alpha(theme.palette.info.main, 0.95) }
        }}
      >
        <Box
          component="span"
          sx={{
            fontSize: '0.5rem',
            fontWeight: 700,
            letterSpacing: 0.6,
            opacity: 0.75,
            lineHeight: 1,
            mb: 0.25
          }}
        >
          CLUB
        </Box>
        <Box component="span" sx={{ lineHeight: 1 }}>
          {selectedClubObj
            ? abbreviateClubName(selectedClubObj.customName || selectedClubObj.name, selectedClubObj.category)
            : '+'}
        </Box>
      </Button>
      )}

      {/* Draft control panel while drawing a target. */}
      {drawMode !== 'none' && (
        <Box
          sx={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 'calc(env(safe-area-inset-bottom) + 8px)',
            zIndex: 5,
            bgcolor: 'background.paper',
            borderRadius: '5px',
            p: 1.5,
            boxShadow: 6
          }}
        >
          {drawMode === 'circle' ? (
            <Stack spacing={1}>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <Typography variant="body2" fontWeight={700}>
                  Radius
                </Typography>
                <Typography fontWeight={800}>{draftRadiusYd}y</Typography>
              </Stack>
              <Stack direction="row" alignItems="center" spacing={2}>
                <Slider
                  aria-label="Radius (yards)"
                  value={draftRadiusYd}
                  min={3}
                  max={80}
                  step={1}
                  valueLabelDisplay="auto"
                  valueLabelFormat={(v) => `${v}y`}
                  onChange={(_, v) => setDraftRadiusYd(v as number)}
                  sx={{ flex: 1 }}
                />
                <Button variant="contained" disabled={!draftCenter} onClick={saveTarget}>
                  Save
                </Button>
              </Stack>
            </Stack>
          ) : (
            <Stack direction="row" alignItems="center" spacing={1}>
              <Typography variant="body2" sx={{ flex: 1 }} fontWeight={700}>
                {draftPoints.length} point{draftPoints.length === 1 ? '' : 's'}
              </Typography>
              <Button
                size="small"
                disabled={!draftPoints.length}
                onClick={() => setDraftPoints((p) => p.slice(0, -1))}
              >
                Undo
              </Button>
              <Button variant="contained" disabled={draftPoints.length < 3} onClick={saveTarget}>
                Finish
              </Button>
            </Stack>
          )}
        </Box>
      )}

      {/* Right-side live stats — each its own card. */}
      {phase === 'logging' && (
        <Box
          sx={{
            position: 'absolute',
            right: 8,
            top: '50%',
            transform: 'translateY(-50%)',
            zIndex: 4,
            display: 'flex',
            flexDirection: 'column',
            gap: 1
          }}
        >
          <Box sx={hudCardSx}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', lineHeight: 1 }}>
              {shots.length}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Shots
            </Typography>
          </Box>
          <Box sx={hudCardSx}>
            <Typography sx={{ fontWeight: 800, fontSize: '1.5rem', lineHeight: 1 }}>
              {lastShotYards != null ? lastShotYards : '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Yards
            </Typography>
          </Box>
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
          {drawMode === 'none' && (
            <Button
              onClick={() => setTargetsDrawerOpen(true)}
              aria-label="Targets"
              sx={{
                alignSelf: 'center',
                width: 56,
                height: 56,
                minWidth: 56,
                p: 0,
                borderRadius: '50%',
                bgcolor: (theme) => alpha(theme.palette.primary.main, 0.78),
                color: '#fff',
                backdropFilter: 'blur(6px)',
                WebkitBackdropFilter: 'blur(6px)',
                '&:hover': { bgcolor: (theme) => alpha(theme.palette.primary.main, 0.9) }
              }}
            >
              <TargetIcon sx={{ width: '100%', height: '100%' }} />
            </Button>
          )}
        </Box>
      )}

      {/* Single running summary card for the current club — tap to manage shots. */}
      {phase === 'logging' && drawMode === 'none' && clubSummary && (
        <Card
          elevation={0}
          sx={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 'calc(env(safe-area-inset-bottom) + 8px)',
            zIndex: 4,
            bgcolor: 'background.paper',
            borderRadius: '5px',
            boxShadow: 4
          }}
        >
          <CardActionArea
            onClick={() => {
              setShotsTab(currentClub ?? 'No club');
              setShotsDrawerOpen(true);
            }}
          >
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Stack direction="row" justifyContent="space-between" alignItems="center">
                <Box sx={{ minWidth: 0 }}>
                  <Stack direction="row" alignItems="center" spacing={1}>
                    <Box
                      sx={{ width: 10, height: 10, borderRadius: '50%', flexShrink: 0, bgcolor: clubColor(currentClub) }}
                    />
                    <Typography fontWeight={700} noWrap>
                      {currentClub ?? 'No club'}
                    </Typography>
                  </Stack>
                  <Typography variant="caption" color="text.secondary">
                    {clubSummary.count} shot{clubSummary.count === 1 ? '' : 's'} tracked · tap to view
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right', flexShrink: 0 }}>
                  <Typography fontWeight={800}>{Math.round(clubSummary.avgCarry)}y avg</Typography>
                  <Typography variant="caption" color="text.secondary">
                    ±{Math.round(clubSummary.dispersion)}y disp
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </CardActionArea>
        </Card>
      )}

      {/* Last shot result, bottom-center. */}
      {phase === 'logging' && lastChip && (
        <Chip
          color="primary"
          label={lastChip}
          sx={{
            position: 'absolute',
            bottom: `calc(env(safe-area-inset-bottom) + ${controlsBottomPx + 8}px)`,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 4,
            fontWeight: 700
          }}
        />
      )}

      {import.meta.env.DEV && phase === 'logging' && (
        <Button
          size="small"
          variant="contained"
          onClick={() => __devEmitSwing({ id: `dev_${Date.now()}`, club: clubLabel(selectedClubId) })}
          sx={{
            position: 'absolute',
            bottom: `calc(env(safe-area-inset-bottom) + ${controlsBottomPx}px)`,
            right: 16,
            zIndex: 4
          }}
        >
          Swing (dev)
        </Button>
      )}

      {error && (
        <Alert
          severity="error"
          sx={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 'calc(env(safe-area-inset-bottom) + 84px)',
            zIndex: 5
          }}
        >
          {error}
        </Alert>
      )}

      {clubHint && phase === 'logging' && drawMode === 'none' && (
        <Alert
          severity="info"
          onClose={() => setClubHint(false)}
          sx={{
            position: 'absolute',
            left: 8,
            right: 8,
            bottom: 'calc(env(safe-area-inset-bottom) + 84px)',
            zIndex: 6
          }}
        >
          Select a club, then tap the screen.
        </Alert>
      )}

      {/* Club picker — same tier-1 / tier-2 affordance as the round GPS. */}
      <Drawer
        anchor="bottom"
        open={clubPickerOpen}
        onClose={() => setClubPickerOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '70dvh',
            bgcolor: 'background.default'
          }
        }}
      >
        <Box sx={{ p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Pick a club
            </Typography>
            <IconButton size="small" onClick={() => setClubPickerOpen(false)}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          {bag.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              No clubs in your bag yet — add some in My Bag.
            </Typography>
          ) : (
            <ClubPicker
              bagClubs={bag}
              clubId={selectedClubId}
              tier1={selectedClubTier1}
              onChange={(nextClubId, nextTier1) => {
                setSelectedClubId(nextClubId);
                setSelectedClubTier1(nextTier1);
                if (nextClubId) {
                  setClubHint(false);
                  setClubPickerOpen(false);
                }
              }}
            />
          )}
        </Box>
      </Drawer>

      {/* All shots — tap a card to open; delete any shot here. */}
      <Drawer
        anchor="bottom"
        open={shotsDrawerOpen}
        onClose={() => setShotsDrawerOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '70dvh',
            bgcolor: 'background.default'
          }
        }}
      >
        <Box sx={{ p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Shots ({shots.length})
            </Typography>
            <IconButton size="small" onClick={() => setShotsDrawerOpen(false)}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          {shots.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No shots yet.
            </Typography>
          ) : (
            <>
              {clubKeys.length > 1 && (
                <Tabs
                  value={effectiveTab}
                  onChange={(_, v) => setShotsTab(v)}
                  variant="scrollable"
                  scrollButtons="auto"
                  sx={{ mb: 1, minHeight: 40 }}
                >
                  {clubKeys.map((k) => (
                    <Tab key={k} value={k} label={k} sx={{ minHeight: 40, textTransform: 'none' }} />
                  ))}
                </Tabs>
              )}
              <Stack spacing={1}>
                {tabShots.map(({ shot: s, n }) => {
                  const off = Math.round(s.offlineYards);
                  const offLabel = off === 0 ? 'straight' : `${Math.abs(off)} ${off > 0 ? 'R' : 'L'}`;
                  const tgt = s.targetId ? targets.find((t) => t.id === s.targetId) ?? null : null;
                  const resultLabel = tgt ? classifyShotVsTarget(origin, tgt, s.land).label : null;
                  return (
                    <Card key={s.id} variant="outlined" sx={{ borderRadius: '5px' }}>
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                          <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                            <Box
                              sx={{
                                width: 10,
                                height: 10,
                                borderRadius: '50%',
                                flexShrink: 0,
                                bgcolor: clubColor(s.club)
                              }}
                            />
                            <Box sx={{ minWidth: 0 }}>
                              <Typography fontWeight={700} noWrap>
                                #{n} · {Math.round(s.totalYards)}y
                                {resultLabel ? ` · ${resultLabel}` : ''}
                              </Typography>
                              <Typography variant="caption" color="text.secondary">
                                {s.club ?? 'No club'} · {offLabel}
                              </Typography>
                            </Box>
                          </Stack>
                          <IconButton
                            aria-label="Delete shot"
                            onClick={() => deleteShot(s.id)}
                            sx={{ color: 'text.secondary', flexShrink: 0 }}
                          >
                            <DeleteOutlineRoundedIcon />
                          </IconButton>
                        </Stack>
                      </CardContent>
                    </Card>
                  );
                })}
              </Stack>
            </>
          )}
        </Box>
      </Drawer>

      {/* Targets — pick one to aim at, draw new ones, or delete. */}
      <Drawer
        anchor="bottom"
        open={targetsDrawerOpen}
        onClose={() => setTargetsDrawerOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '70dvh',
            bgcolor: 'background.default'
          }
        }}
      >
        <Box sx={{ p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 1.5 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Targets
            </Typography>
            <IconButton size="small" onClick={() => setTargetsDrawerOpen(false)}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>

          <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => {
                cancelDraw();
                setDrawMode('circle');
                setTargetsDrawerOpen(false);
              }}
            >
              Draw circle
            </Button>
            <Button
              fullWidth
              variant="outlined"
              onClick={() => {
                cancelDraw();
                setDrawMode('polygon');
                setTargetsDrawerOpen(false);
              }}
            >
              Draw shape
            </Button>
          </Stack>

          {targets.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No targets yet — draw a circle or shape around a green.
            </Typography>
          ) : (
            <Stack spacing={1}>
              {targets.map((t, i) => {
                const c = targetCenter(t);
                // Shots actually aimed at this target, and how they finished.
                const aimed = shots.filter((s) => s.targetId === t.id);
                const onTarget = aimed.filter((s) => classifyShotVsTarget(origin, t, s.land).hit).length;
                const closest = aimed.length
                  ? Math.round(Math.min(...aimed.map((s) => haversineMeters(c, s.land))) / 0.9144)
                  : null;
                const name = t.label || `${t.kind === 'circle' ? 'Circle' : 'Shape'} ${i + 1}`;
                return (
                  <Card
                    key={t.id}
                    variant={t.id === selectedTargetId ? 'elevation' : 'outlined'}
                    sx={{ borderRadius: '5px', bgcolor: t.id === selectedTargetId ? 'action.selected' : undefined }}
                  >
                    <Stack direction="row" alignItems="center">
                      <CardActionArea
                        onClick={() => {
                          setSelectedTargetId(t.id);
                          setTargetsDrawerOpen(false);
                        }}
                      >
                        <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                          <Typography fontWeight={700} noWrap>
                            {name}
                            {t.id === selectedTargetId ? ' · aiming' : ''}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {aimed.length ? `${onTarget}/${aimed.length} on target` : 'No shots yet'}
                            {closest != null ? ` · closest ${closest}y` : ''}
                          </Typography>
                        </CardContent>
                      </CardActionArea>
                      <IconButton
                        aria-label="Delete target"
                        onClick={() => removeTarget(t.id)}
                        sx={{ color: 'text.secondary', mr: 0.5 }}
                      >
                        <DeleteOutlineRoundedIcon />
                      </IconButton>
                    </Stack>
                  </Card>
                );
              })}
            </Stack>
          )}
        </Box>
      </Drawer>

      <RangeTour open={tourOpen} onClose={closeTour} />
    </Box>
  );
}
