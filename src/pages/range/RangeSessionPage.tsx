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
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { useBagStore } from '@/stores/bagStore';
import { ClubPicker, type ClubTier1 } from '@/features/round/AddShotSheet';
import { abbreviateClubName } from '@/features/bag/abbreviateClubName';
import { ensureGpsPermission, getCurrentPosition } from '@/services/gpsService';
import { rangeRepo } from '@/services/rangeRepo';
import {
  onSwing,
  offSwing,
  resolveSwingEventId,
  __devEmitSwing,
  type SwingEvent
} from '@/services/rangeSwingBridge';
import { RangeMap, type ShotMarker } from '@/features/range/RangeMap';
import { shotChipLabel } from '@/features/range/rangeStats';
import { destinationPoint, yardsToM } from '@/features/range/rangeGeo';
import type { LatLng, RangeSession, RangeShot } from '@/types/range';

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
  const [shotsDrawerOpen, setShotsDrawerOpen] = useState(false);
  const [shotsTab, setShotsTab] = useState<string | null>(null);

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

  // --- taps ---------------------------------------------------------------
  const handleTap = useCallback(
    async (p: LatLng) => {
      if (busy || phase !== 'logging' || !origin || !userId) return;
      setBusy(true);
      setError(null);
      try {
        // Lazily open the session on the first shot, aiming straight up the
        // range (north). Avoids empty sessions if the user never logs a shot.
        let activeSession = session;
        if (!activeSession) {
          const target = destinationPoint(origin, 0, yardsToM(250));
          activeSession = await rangeRepo.createSession(userId, origin, target);
          setSession(activeSession);
        }
        // A pending swing event (from the watch bridge) wins over the manual
        // club selector and supplies the swing_event_id.
        const swing = pendingSwingRef.current;
        const club = swing?.club ?? clubLabel(selectedClubId);
        // Only link a real (persisted) swing_metrics uuid; null otherwise.
        const swingEventId = swing ? resolveSwingEventId(swing.id) : null;
        const shot = await rangeRepo.logShot({ session: activeSession, land: p, club, swingEventId });
        setShots((prev) => [...prev, shot]);
        setLastChip(shotChipLabel(shot.totalYards, shot.offlineYards));
        pendingSwingRef.current = null;
        setPendingSwing(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not log shot');
      } finally {
        setBusy(false);
      }
    },
    [busy, phase, origin, userId, session, selectedClubId, clubLabel]
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
      await rangeRepo.endSession(session.id);
      navigate(`/range/summary/${session.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not end session');
      setBusy(false);
      endingRef.current = false; // allow retry
    }
  }, [session, navigate]);

  const shotMarkers: ShotMarker[] = useMemo(
    () => shots.map((s, i) => ({ lng: s.land.lng, lat: s.land.lat, n: i + 1 })),
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
  const instruction = pendingSwing
    ? 'Swing detected — tap where the ball landed.'
    : 'Tap where the ball landed.';

  return (
    <Box sx={{ position: 'fixed', inset: 0, overflow: 'hidden' }}>
      <RangeMap
        origin={origin}
        target={session ? session.target : null}
        bearing={session ? session.targetBearing : 0}
        shots={shotMarkers}
        showArcs
        bottomBar={phase === 'logging'}
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

      {/* Club selection — always present from load, just the circle. */}
      <Button
        onClick={() => setClubPickerOpen(true)}
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
          bgcolor: 'rgba(0,0,0,0.6)',
          color: '#fff',
          border: 1.5,
          borderColor: selectedClubObj ? 'primary.main' : 'rgba(255,255,255,0.35)',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
          fontWeight: 800,
          fontSize: '0.95rem',
          lineHeight: 1,
          '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' }
        }}
      >
        {selectedClubObj
          ? abbreviateClubName(selectedClubObj.customName || selectedClubObj.name, selectedClubObj.category)
          : '+'}
      </Button>

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
        </Box>
      )}

      {/* Single running summary card for the current club — tap to manage shots. */}
      {phase === 'logging' && clubSummary && (
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
                  <Typography fontWeight={700} noWrap>
                    {currentClub ?? 'No club'}
                  </Typography>
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
                if (nextClubId) setClubPickerOpen(false);
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
                  return (
                    <Card key={s.id} variant="outlined" sx={{ borderRadius: '5px' }}>
                      <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
                        <Stack direction="row" alignItems="center" justifyContent="space-between">
                          <Box sx={{ minWidth: 0 }}>
                            <Typography fontWeight={700} noWrap>
                              #{n} · {Math.round(s.totalYards)}y
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                              {s.club ?? 'No club'} · {offLabel}
                            </Typography>
                          </Box>
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
    </Box>
  );
}
