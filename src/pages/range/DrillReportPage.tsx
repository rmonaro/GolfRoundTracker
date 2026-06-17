import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, CircularProgress, Divider, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import CompareArrowsRoundedIcon from '@mui/icons-material/CompareArrowsRounded';
import { useNavigate, useParams } from 'react-router-dom';
import { useBagStore } from '@/stores/bagStore';
import { useDrillRunStore } from '@/stores/drillRunStore';
import { useBag } from '@/features/bag/useBag';
import { rangeRepo } from '@/services/rangeRepo';
import { getDrill } from '@/features/range/drills/registry';
import { zoneFor } from '@/features/range/drills/engine';
import { bagToDrillClubs } from '@/features/range/drills/fromBag';
import type { DrillContext, DrillReport, DrillState, ShotRecord } from '@/features/range/drills/types';
import { practicePageSx } from '../practice/practicePageSx';
import type { RangeSession, RangeShot } from '@/types/range';

export function DrillReportPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const bag = useBagStore((s) => s.clubs);
  const setSelection = useDrillRunStore((s) => s.setSelection);
  const { editBagClub } = useBag();

  const [session, setSession] = useState<RangeSession | null>(null);
  const [shots, setShots] = useState<RangeShot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);
  const [confirmSave, setConfirmSave] = useState(false);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const [s, sh] = await Promise.all([rangeRepo.getSession(sessionId), rangeRepo.getSessionShots(sessionId)]);
        if (cancelled) return;
        setSession(s);
        setShots(sh);
      } catch (err) {
        console.warn('[drill] report load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const definition = getDrill(session?.drillId);

  // Reconstruct the drill state from the persisted shots, then re-run report().
  const report = useMemo<DrillReport | null>(() => {
    if (!definition || !session) return null;
    const ctx: DrillContext = { bag: bagToDrillClubs(bag), config: session.drillConfig ?? {} };
    const shotsLogged: ShotRecord[] = shots.map((s) => ({
      club: s.club,
      prescribedClub: s.prescribedClub,
      targetYards: s.targetYards,
      carryYards: s.carryYards,
      offlineYards: s.offlineYards,
      totalYards: s.totalYards,
      proximityYards: s.proximityYards,
      zone: s.proximityYards != null && s.targetYards != null ? zoneFor(s.proximityYards, s.targetYards) : null
    }));
    const state: DrillState = { shotsLogged, current: null, scratch: {} };
    return definition.report(state, ctx);
  }, [definition, session, shots, bag]);

  const repeat = () => {
    if (!session?.drillId) return;
    setSelection({ drillId: session.drillId, config: session.drillConfig ?? {} });
    navigate('/drills/run');
  };

  // Gapping → save measured carries into the bag's typical distances.
  const ladder = (report?.kind === 'gapping' ? (report.data.ladder as LadderRow[]) : []) ?? [];
  const saveCarries = () => {
    let count = 0;
    for (const row of ladder) {
      const club = bag.find((c) => (c.customName || c.name) === row.club);
      if (club) {
        editBagClub.mutate({ bagId: club.bagId, typicalDistanceYards: Math.round(row.avgCarry) });
        count++;
      }
    }
    setSaved(count > 0);
    setConfirmSave(false);
  };

  if (loading) {
    return (
      <Box sx={{ minHeight: '60dvh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!session || !definition || !report) {
    return (
      <Box sx={practicePageSx(560)}>
        <Typography variant="h6">Report unavailable</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          This drill run couldn't be loaded.
        </Typography>
        <Button variant="contained" sx={{ mt: 2 }} onClick={() => navigate('/practice')}>
          Back to practice
        </Button>
      </Box>
    );
  }

  return (
    <Box sx={practicePageSx(620)}>
      <Typography variant="caption" sx={{ fontWeight: 800, letterSpacing: 0.5, color: 'text.secondary' }}>
        {definition.name.toUpperCase()} · COMPLETE
      </Typography>

      {/* Headline — the single most useful number. */}
      <Card variant="outlined" sx={{ borderRadius: '8px', mt: 1 }}>
        <CardContent sx={{ textAlign: 'center', py: 3 }}>
          <Typography sx={{ fontWeight: 900, fontSize: '3rem', lineHeight: 1, color: 'primary.main' }}>
            {report.headline.value}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {report.headline.label}
          </Typography>
        </CardContent>
      </Card>

      {/* Stat grid. */}
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5, mt: 1.5 }}>
        {report.stats.map((st) => (
          <Card key={st.label} variant="outlined" sx={{ borderRadius: '5px' }}>
            <CardContent sx={{ p: 1.5, '&:last-child': { pb: 1.5 } }}>
              <Typography sx={{ fontWeight: 800, fontSize: '1.25rem' }}>{st.value}</Typography>
              <Typography variant="caption" color="text.secondary">
                {st.label}
              </Typography>
            </CardContent>
          </Card>
        ))}
      </Box>

      {/* Drill-specific detail. */}
      <Box sx={{ mt: 2 }}>
        {report.kind === 'gapping' && (
          <GappingDetail
            ladder={ladder}
            flags={(report.data.flags as LadderFlag[]) ?? []}
            onSave={() => setConfirmSave(true)}
            confirmSave={confirmSave}
            onConfirm={saveCarries}
            onCancel={() => setConfirmSave(false)}
            saved={saved}
          />
        )}
        {report.kind === 'proximity' && <Scatter points={(report.data.scatter as ScatterPt[]) ?? []} />}
        {report.kind === 'rotation' && (
          <RotationDetail rows={(report.data.rows as RotationRow[]) ?? []} withTargets={!!report.data.withTargets} />
        )}
      </Box>

      <Stack spacing={1} sx={{ mt: 3 }}>
        <Button variant="contained" onClick={repeat}>
          Repeat drill
        </Button>
        <Button variant="outlined" onClick={() => navigate('/drills')}>
          New drill
        </Button>
        <Button onClick={() => navigate('/practice')}>Done</Button>
      </Stack>
    </Box>
  );
}

// --- detail blocks ---------------------------------------------------------

interface LadderRow {
  club: string;
  shots: number;
  avgCarry: number;
  dispersion: number;
}
interface LadderFlag {
  kind: 'gap' | 'overlap';
  from: string;
  to: string;
  yards: number;
}

function GappingDetail({
  ladder,
  flags,
  onSave,
  confirmSave,
  onConfirm,
  onCancel,
  saved
}: {
  ladder: LadderRow[];
  flags: LadderFlag[];
  onSave: () => void;
  confirmSave: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  saved: boolean;
}) {
  const max = ladder.length ? Math.max(...ladder.map((r) => r.avgCarry)) : 1;
  return (
    <Card variant="outlined" sx={{ borderRadius: '5px' }}>
      <CardContent>
        <Typography sx={{ fontWeight: 800, mb: 1.5 }}>Carry ladder</Typography>
        <Stack spacing={1}>
          {ladder.map((r) => (
            <Box key={r.club}>
              <Stack direction="row" justifyContent="space-between" sx={{ mb: 0.25 }}>
                <Typography variant="body2" fontWeight={700}>
                  {r.club}
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  {Math.round(r.avgCarry)}y · ±{Math.round(r.dispersion)}y
                </Typography>
              </Stack>
              <Box sx={{ height: 8, borderRadius: 999, bgcolor: (t) => alpha(t.palette.primary.main, 0.15) }}>
                <Box
                  sx={{
                    height: 8,
                    borderRadius: 999,
                    width: `${Math.max(4, Math.round((r.avgCarry / max) * 100))}%`,
                    bgcolor: 'primary.main'
                  }}
                />
              </Box>
            </Box>
          ))}
        </Stack>

        {flags.length > 0 && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Stack spacing={0.75}>
              {flags.map((f, i) => (
                <Stack key={i} direction="row" spacing={1} alignItems="center">
                  <WarningAmberRoundedIcon
                    fontSize="small"
                    sx={{ color: f.kind === 'gap' ? 'warning.main' : 'info.main' }}
                  />
                  <Typography variant="caption" color="text.secondary">
                    {f.kind === 'gap' ? 'Gap' : 'Overlap'}: {f.from} → {f.to} ({f.yards}y)
                  </Typography>
                </Stack>
              ))}
            </Stack>
          </>
        )}

        <Divider sx={{ my: 1.5 }} />
        {saved ? (
          <Typography variant="body2" color="success.main" sx={{ fontWeight: 700 }}>
            Saved to your bag ✓
          </Typography>
        ) : confirmSave ? (
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              Overwrite your bag's typical distances with these measured carries?
            </Typography>
            <Stack direction="row" spacing={1}>
              <Button variant="contained" size="small" onClick={onConfirm}>
                Overwrite
              </Button>
              <Button size="small" onClick={onCancel}>
                Cancel
              </Button>
            </Stack>
          </Stack>
        ) : (
          <Button variant="outlined" fullWidth onClick={onSave}>
            Save these carries to my bag
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

interface ScatterPt {
  dCarry: number;
  offline: number;
  zone: 'great' | 'good' | 'miss' | null;
}

function Scatter({ points }: { points: ScatterPt[] }) {
  const SIZE = 220;
  const maxAbs = Math.max(10, ...points.map((p) => Math.max(Math.abs(p.dCarry), Math.abs(p.offline))));
  const color = (z: ScatterPt['zone']) =>
    z === 'great' ? 'success.main' : z === 'good' ? 'warning.main' : 'error.main';
  return (
    <Card variant="outlined" sx={{ borderRadius: '5px' }}>
      <CardContent>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
          <CompareArrowsRoundedIcon fontSize="small" color="primary" />
          <Typography sx={{ fontWeight: 800 }}>Dispersion vs target</Typography>
        </Stack>
        <Box
          sx={{
            position: 'relative',
            width: SIZE,
            height: SIZE,
            mx: 'auto',
            borderRadius: '8px',
            bgcolor: (t) => alpha(t.palette.text.primary, 0.04)
          }}
        >
          {/* crosshair at the target */}
          <Box sx={{ position: 'absolute', left: 0, right: 0, top: '50%', height: '1px', bgcolor: 'divider' }} />
          <Box sx={{ position: 'absolute', top: 0, bottom: 0, left: '50%', width: '1px', bgcolor: 'divider' }} />
          {points.map((p, i) => (
            <Box
              key={i}
              sx={{
                position: 'absolute',
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: color(p.zone),
                border: '1.5px solid #fff',
                left: `calc(50% + ${(p.offline / maxAbs) * (SIZE / 2 - 8)}px - 5px)`,
                top: `calc(50% - ${(p.dCarry / maxAbs) * (SIZE / 2 - 8)}px - 5px)`
              }}
            />
          ))}
        </Box>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', textAlign: 'center', mt: 1 }}>
          Up = long · right = right of target. Center = on the number.
        </Typography>
      </CardContent>
    </Card>
  );
}

interface RotationRow {
  club: string;
  shots: number;
  avgCarry: number;
  dispersion: number;
  avgProximity: number | null;
}

function RotationDetail({ rows, withTargets }: { rows: RotationRow[]; withTargets: boolean }) {
  return (
    <Card variant="outlined" sx={{ borderRadius: '5px' }}>
      <CardContent>
        <Typography sx={{ fontWeight: 800, mb: 1 }}>By club, under rotation</Typography>
        <Stack divider={<Divider />} spacing={1}>
          {rows.map((r) => (
            <Stack key={r.club} direction="row" justifyContent="space-between" alignItems="center">
              <Box>
                <Typography variant="body2" fontWeight={700}>
                  {r.club}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  {r.shots} shot{r.shots === 1 ? '' : 's'} · {Math.round(r.avgCarry)}y carry
                </Typography>
              </Box>
              <Box sx={{ textAlign: 'right' }}>
                {withTargets && r.avgProximity != null ? (
                  <Typography variant="body2" fontWeight={800} color="primary">
                    {Math.round(r.avgProximity)}y prox
                  </Typography>
                ) : (
                  <Typography variant="body2" fontWeight={800} color="primary">
                    ±{Math.round(r.dispersion)}y
                  </Typography>
                )}
                <Typography variant="caption" color="text.secondary">
                  {withTargets ? 'avg proximity' : 'dispersion'}
                </Typography>
              </Box>
            </Stack>
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}
