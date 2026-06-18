import { useMemo, useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
  ToggleButtonGroup,
  ToggleButton
} from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import ArrowUpwardRoundedIcon from '@mui/icons-material/ArrowUpwardRounded';
import ArrowDownwardRoundedIcon from '@mui/icons-material/ArrowDownwardRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import MoreVertRoundedIcon from '@mui/icons-material/MoreVertRounded';
import FlashOnRoundedIcon from '@mui/icons-material/FlashOnRounded';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { useBag } from '@/features/bag/useBag';
import { CATEGORY_LABELS, DEFAULT_BAG } from '@/features/bag/defaultClubs';
import { CLUB_BRANDS, OTHER_BRAND } from '@/features/bag/brands';
import {
  getDefaultYardage,
  getDefaultYardageByName
} from '@/features/bag/clubYardageDefaults';
import { useAuthStore } from '@/stores/authStore';
import { type BagClub, type ClubCategory, type SkillLevel, type Gender } from '@/models';

const CATEGORY_ORDER: ClubCategory[] = ['driver', 'wood', 'hybrid', 'iron', 'wedge', 'putter'];

// Common numbers per category, shown as tappable boxes (per UX spec).
const NUMBER_OPTIONS: Partial<Record<ClubCategory, number[]>> = {
  wood: [2, 3, 4, 5, 7, 9],
  hybrid: [2, 3, 4, 5, 6, 7],
  iron: [1, 2, 3, 4, 5, 6, 7, 8, 9]
};

const COMMON_WEDGE_LOFTS = [46, 48, 50, 52, 54, 56, 58, 60, 62];

// Wedge type abbreviations, ordered by typical loft (low → high).
// PW = Pitching, GW = Gap, AW = Approach (alt name for Gap), SW = Sand, LW = Lob.
const WEDGE_TYPES = ['PW', 'GW', 'AW', 'SW', 'LW'] as const;
type WedgeType = (typeof WEDGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function BagPage() {
  const { data, isLoading, addClub, removeClub, editBagClub, reorder, quickAdd, clearBag } = useBag();
  const skillLevel = useAuthStore((s) => s.profile?.skill_level ?? null);
  const gender = useAuthStore((s) => s.profile?.gender ?? null);
  const [addOpen, setAddOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [editing, setEditing] = useState<BagClub | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const grouped = useMemo(() => groupByCategory(data ?? []), [data]);
  const isEmpty = !isLoading && (data?.length ?? 0) === 0;

  const move = (bagId: string, direction: 1 | -1) => {
    const list = (data ?? []).slice().sort((a, b) => a.orderPosition - b.orderPosition);
    const idx = list.findIndex((c) => c.bagId === bagId);
    if (idx < 0) return;
    const target = idx + direction;
    if (target < 0 || target >= list.length) return;
    const next = list.slice();
    [next[idx], next[target]] = [next[target], next[idx]];
    reorder.mutate(next.map((c) => c.bagId));
  };

  return (
    <Box>
      <PageHeader
        title="My Bag"
        back="/"
        subtitle={data ? `${data.length} ${data.length === 1 ? 'club' : 'clubs'}` : ' '}
        action={
          (data?.length ?? 0) > 0 ? (
            <Stack direction="row" spacing={0.5} alignItems="center">
              <Button
                startIcon={<AddRoundedIcon />}
                variant="contained"
                onClick={() => setAddOpen(true)}
                sx={{ minHeight: 40 }}
              >
                Add
              </Button>
              <IconButton aria-label="more" onClick={(e) => setMenuAnchor(e.currentTarget)}>
                <MoreVertRoundedIcon />
              </IconButton>
              <Menu anchorEl={menuAnchor} open={!!menuAnchor} onClose={() => setMenuAnchor(null)}>
                <MenuItem
                  onClick={() => {
                    setMenuAnchor(null);
                    setQuickOpen(true);
                  }}
                >
                  Quick add common clubs
                </MenuItem>
                <MenuItem
                  onClick={() => {
                    setMenuAnchor(null);
                    setConfirmClear(true);
                  }}
                  sx={{ color: 'error.main' }}
                >
                  Clear bag
                </MenuItem>
              </Menu>
            </Stack>
          ) : null
        }
      />

      {isLoading && (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      )}

      {isEmpty && (
        <Stack spacing={2} px={2}>
          <EmptyState
            icon={<SportsGolfRoundedIcon fontSize="inherit" />}
            title="Your bag is empty"
            description="Add the clubs you actually carry. We won't assume — you're in control."
          />
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
            <CardContent>
              <Stack spacing={1.5}>
                <Button
                  variant="contained"
                  size="large"
                  startIcon={<AddRoundedIcon />}
                  onClick={() => setAddOpen(true)}
                  sx={{ minHeight: 56 }}
                >
                  Add a Club
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  startIcon={<FlashOnRoundedIcon />}
                  onClick={() => setQuickOpen(true)}
                  sx={{ minHeight: 56 }}
                >
                  Quick Add Common Clubs
                </Button>
                <Typography variant="caption" color="text.secondary" align="center">
                  Pick brand and club type — we'll name it for you.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        </Stack>
      )}

      <Stack spacing={2} px={2} pb={3}>
        {grouped.map(({ category, clubs }) => (
          <Box key={category}>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
            >
              {CATEGORY_LABELS[category]}
            </Typography>
            <Stack spacing={1} mt={0.5}>
              {clubs.map((club) => {
                const subtitle = clubSubtitleLine(club);
                return (
                  <Card
                    key={club.bagId}
                    variant="outlined"
                    elevation={0}
                    sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}
                  >
                    <CardContent
                      sx={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        py: 1.25,
                        '&:last-child': { pb: 1.25 }
                      }}
                    >
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Stack direction="row" alignItems="center" spacing={0.75}>
                          <Typography variant="subtitle1" sx={{ fontWeight: 600 }} noWrap>
                            {club.customName || club.name}
                          </Typography>
                          {club.typicalDistanceYards != null && (
                            <Chip
                              size="small"
                              label={`${club.typicalDistanceYards} yds`}
                              color="primary"
                              variant="outlined"
                              sx={{
                                height: 22,
                                '.MuiChip-label': { px: 0.75, fontSize: '0.72rem', fontWeight: 600 }
                              }}
                            />
                          )}
                        </Stack>
                        {subtitle && (
                          <Typography variant="caption" color="text.secondary" noWrap>
                            {subtitle}
                          </Typography>
                        )}
                      </Box>
                      <IconButton size="small" aria-label="up" onClick={() => move(club.bagId, -1)}>
                        <ArrowUpwardRoundedIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" aria-label="down" onClick={() => move(club.bagId, 1)}>
                        <ArrowDownwardRoundedIcon fontSize="small" />
                      </IconButton>
                      <IconButton size="small" aria-label="edit" onClick={() => setEditing(club)}>
                        <EditRoundedIcon fontSize="small" />
                      </IconButton>
                      <IconButton
                        size="small"
                        aria-label="remove"
                        color="error"
                        onClick={() => removeClub.mutate(club.bagId)}
                      >
                        <DeleteRoundedIcon fontSize="small" />
                      </IconButton>
                    </CardContent>
                  </Card>
                );
              })}
            </Stack>
          </Box>
        ))}
      </Stack>

      <ClubFormDialog
        mode="add"
        skillLevel={skillLevel}
        gender={gender}
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={(values) => {
          const name = buildClubName(
            values.category,
            values.number,
            values.loft,
            values.wedgeType
          );
          addClub.mutate({
            name,
            category: values.category,
            brand: values.brand,
            model: values.model,
            loft: values.loft,
            typicalDistanceYards: values.typicalDistanceYards
          });
          setAddOpen(false);
        }}
      />
      <ClubFormDialog
        mode="edit"
        skillLevel={skillLevel}
        gender={gender}
        open={!!editing}
        initial={editing ? parseExistingClub(editing) : undefined}
        onClose={() => setEditing(null)}
        onSubmit={(values) => {
          if (editing) {
            const newName = buildClubName(
              values.category,
              values.number,
              values.loft,
              values.wedgeType
            );
            const nameChanged = newName !== editing.name;
            const categoryChanged = values.category !== editing.category;
            editBagClub.mutate({
              bagId: editing.bagId,
              customName: null,
              brand: values.brand,
              model: values.model,
              loft: values.loft,
              typicalDistanceYards: values.typicalDistanceYards,
              newClub: nameChanged || categoryChanged ? { name: newName, category: values.category } : undefined
            });
          }
          setEditing(null);
        }}
      />
      <QuickAddDialog
        open={quickOpen}
        existing={data ?? []}
        onClose={() => setQuickOpen(false)}
        onSubmit={(clubs) => {
          if (clubs.length > 0) {
            quickAdd.mutate(
              clubs.map((c) => ({
                ...c,
                typicalDistanceYards: getDefaultYardageByName(skillLevel, gender, c.name, c.category)
              }))
            );
          }
          setQuickOpen(false);
        }}
      />
      <ConfirmDialog
        open={confirmClear}
        title="Clear bag?"
        body={`This will remove all ${data?.length ?? 0} clubs from your bag. You can add them back any time.`}
        confirmLabel="Clear Bag"
        onClose={() => setConfirmClear(false)}
        onConfirm={() => {
          clearBag.mutate();
          setConfirmClear(false);
        }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Helpers — derive name, parse existing
// ---------------------------------------------------------------------------

function groupByCategory(list: BagClub[]) {
  const sorted = [...list].sort((a, b) => a.orderPosition - b.orderPosition);
  const buckets = new Map<ClubCategory, BagClub[]>();
  for (const c of sorted) {
    const arr = buckets.get(c.category) ?? [];
    arr.push(c);
    buckets.set(c.category, arr);
  }
  return CATEGORY_ORDER.filter((cat) => buckets.has(cat)).map((cat) => ({
    category: cat,
    clubs: buckets.get(cat)!
  }));
}

function clubSubtitleLine(club: BagClub): string | null {
  const parts: string[] = [];
  if (club.brand) parts.push(club.brand);
  if (club.model) parts.push(club.model);
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatLoft(loft: number): string {
  const rounded = Math.round(loft * 10) / 10;
  return `${rounded}°`;
}

function buildClubName(
  category: ClubCategory,
  number: number | null,
  loft: number | null,
  wedgeType: WedgeType | null
): string {
  switch (category) {
    case 'driver':
      return 'Driver';
    case 'putter':
      return 'Putter';
    case 'wedge':
      if (wedgeType && loft != null) return `${wedgeType} ${formatLoft(loft)}`;
      if (wedgeType) return wedgeType;
      if (loft != null) return `${formatLoft(loft)} Wedge`;
      return 'Wedge';
    case 'wood':
      return number != null ? `${number} Wood` : 'Wood';
    case 'hybrid':
      return number != null ? `${number} Hybrid` : 'Hybrid';
    case 'iron':
      return number != null ? `${number} Iron` : 'Iron';
  }
}

/**
 * Recover the structured form values from an already-saved club.
 * For legacy / quick-added clubs the regex may not match — that's fine, we just leave
 * `number` / `loft` empty and the user picks them again.
 */
function parseExistingClub(club: BagClub): ClubFormValues {
  let number: number | null = null;
  let loft: number | null = club.loft ?? null;
  let wedgeType: WedgeType | null = null;

  if (club.category === 'wedge') {
    // Match in priority order: "PW 46°", "56° Wedge", "PW"
    const both = /^(PW|GW|AW|SW|LW)\s+(\d+(?:\.\d+)?)°$/i.exec(club.name);
    const loftOnly = /^(\d+(?:\.\d+)?)°\s*Wedge$/i.exec(club.name);
    const typeOnly = /^(PW|GW|AW|SW|LW)$/i.exec(club.name);
    if (both) {
      wedgeType = both[1].toUpperCase() as WedgeType;
      loft = Number(both[2]);
    } else if (loftOnly) {
      loft = Number(loftOnly[1]);
    } else if (typeOnly) {
      wedgeType = typeOnly[1].toUpperCase() as WedgeType;
    }
  } else if (
    club.category === 'iron' ||
    club.category === 'wood' ||
    club.category === 'hybrid'
  ) {
    const m = /^(\d+)\s+(Iron|Wood|Hybrid)$/i.exec(club.name);
    if (m) number = Number(m[1]);
  }

  return {
    category: club.category,
    number,
    loft,
    wedgeType,
    brand: club.brand,
    model: club.model,
    typicalDistanceYards: club.typicalDistanceYards
  };
}

// ---------------------------------------------------------------------------
// Add / Edit dialog — brand → category → number-or-loft → (optional model)
// ---------------------------------------------------------------------------

interface ClubFormValues {
  category: ClubCategory;
  number: number | null;
  loft: number | null;
  wedgeType: WedgeType | null;
  brand: string | null;
  model: string | null;
  typicalDistanceYards: number | null;
}

interface ClubFormDialogProps {
  mode: 'add' | 'edit';
  skillLevel: SkillLevel | null;
  gender: Gender | null;
  open: boolean;
  initial?: ClubFormValues;
  onClose: () => void;
  onSubmit: (values: ClubFormValues) => void;
}

function ClubFormDialog({ mode, skillLevel, gender, open, initial, onClose, onSubmit }: ClubFormDialogProps) {
  const [brandSelection, setBrandSelection] = useState<string>('');
  const [customBrand, setCustomBrand] = useState<string>('');
  const [category, setCategory] = useState<ClubCategory>('iron');
  const [number, setNumber] = useState<number | null>(null);
  const [loft, setLoft] = useState<string>('');
  const [wedgeType, setWedgeType] = useState<WedgeType | null>(null);
  const [model, setModel] = useState<string>('');
  const [typicalDistance, setTypicalDistance] = useState<string>('');
  // Whether the user has manually edited the distance field — once true, we
  // stop auto-filling so we don't overwrite their input.
  const [distanceTouched, setDistanceTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    // In edit mode the existing value is the user's own — treat it as touched.
    // In add mode we start empty and let the auto-prefill fill it in.
    setDistanceTouched(mode === 'edit');
    if (initial) {
      setCategory(initial.category);
      setNumber(initial.number);
      setLoft(initial.loft != null ? String(initial.loft) : '');
      setWedgeType(initial.wedgeType);
      setModel(initial.model ?? '');
      setTypicalDistance(
        initial.typicalDistanceYards != null ? String(initial.typicalDistanceYards) : ''
      );
      if (initial.brand) {
        if ((CLUB_BRANDS as readonly string[]).includes(initial.brand)) {
          setBrandSelection(initial.brand);
          setCustomBrand('');
        } else {
          setBrandSelection(OTHER_BRAND);
          setCustomBrand(initial.brand);
        }
      } else {
        setBrandSelection('');
        setCustomBrand('');
      }
    } else {
      setBrandSelection('');
      setCustomBrand('');
      setCategory('iron');
      setNumber(null);
      setLoft('');
      setWedgeType(null);
      setModel('');
      setTypicalDistance('');
    }
  }, [open, initial]);

  // Reset conditional fields whenever category changes so state stays consistent.
  useEffect(() => {
    if (category === 'wedge' || category === 'driver' || category === 'putter') {
      setNumber(null);
    }
    if (category !== 'wedge') {
      setLoft('');
      setWedgeType(null);
    }
  }, [category]);

  // Auto-prefill typical distance from the skill-level table while the user is
  // building the club, until they manually type something into the field.
  useEffect(() => {
    if (!open || distanceTouched || !skillLevel || !gender) return;
    if (category === 'putter') return;
    const loftValue = loft.trim() === '' ? null : Number(loft);
    const suggested = getDefaultYardage(skillLevel, gender, {
      category,
      number,
      wedgeType,
      loft: loftValue != null && Number.isFinite(loftValue) ? loftValue : null
    });
    setTypicalDistance(suggested != null ? String(suggested) : '');
  }, [open, distanceTouched, skillLevel, gender, category, number, wedgeType, loft]);

  const resolvedBrand =
    brandSelection === OTHER_BRAND ? customBrand.trim() || null : brandSelection || null;

  const needsNumber = category === 'wood' || category === 'hybrid' || category === 'iron';
  const isWedge = category === 'wedge';
  const loftNumber = loft.trim() === '' ? null : Number(loft);
  const loftIsNumeric = loftNumber != null && Number.isFinite(loftNumber) && loftNumber > 0;
  // For a wedge we accept any combination of (type, loft) as long as at least one is set.
  const wedgeValid = !isWedge || wedgeType != null || loftIsNumeric;
  const numberValid = !needsNumber || number != null;
  const brandValid = brandSelection !== OTHER_BRAND || customBrand.trim().length > 0;
  const canSubmit = numberValid && wedgeValid && brandValid;

  const previewName = buildClubName(
    category,
    number,
    loftIsNumeric ? loftNumber : null,
    wedgeType
  );

  const typicalDistanceNum = (() => {
    const t = typicalDistance.trim();
    if (t === '') return null;
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const submit = () => {
    onSubmit({
      category,
      number: needsNumber ? number : null,
      loft: isWedge && loftIsNumeric ? loftNumber : null,
      wedgeType: isWedge ? wedgeType : null,
      brand: resolvedBrand,
      model: model.trim() || null,
      typicalDistanceYards: typicalDistanceNum
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: '5px' } }}>
      <DialogTitle>{mode === 'add' ? 'Add club' : 'Edit club'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2} mt={1}>
          {/* 1. BRAND */}
          <TextField
            label="Brand"
            select
            value={brandSelection}
            onChange={(e) => setBrandSelection(e.target.value)}
          >
            <MenuItem value="">— None —</MenuItem>
            {CLUB_BRANDS.map((b) => (
              <MenuItem key={b} value={b}>
                {b}
              </MenuItem>
            ))}
            <MenuItem value={OTHER_BRAND}>{OTHER_BRAND}…</MenuItem>
          </TextField>
          {brandSelection === OTHER_BRAND && (
            <TextField
              label="Brand name"
              value={customBrand}
              onChange={(e) => setCustomBrand(e.target.value)}
              placeholder="Type the brand"
              required
            />
          )}

          {/* 2. CLUB TYPE (category) */}
          <Box>
            <FieldLabel>Club Type</FieldLabel>
            <ToggleButtonGroup
              exclusive
              value={category}
              onChange={(_, v) => v && setCategory(v as ClubCategory)}
              fullWidth
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: 0.75,
                '& .MuiToggleButton-root': {
                  minHeight: 52,
                  borderRadius: '5px',
                  textTransform: 'none',
                  fontWeight: 600,
                  border: '1px solid',
                  borderColor: 'divider'
                },
                '& .Mui-selected': {
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  '&:hover': { bgcolor: 'primary.dark' }
                }
              }}
            >
              {CATEGORY_ORDER.map((cat) => (
                <ToggleButton key={cat} value={cat}>
                  {CATEGORY_LABELS[cat]}
                </ToggleButton>
              ))}
            </ToggleButtonGroup>
          </Box>

          {/* 3a. NUMBER (only for wood / hybrid / iron) */}
          {needsNumber && (
            <Box>
              <FieldLabel>Number</FieldLabel>
              <NumberBoxes
                values={NUMBER_OPTIONS[category] ?? []}
                value={number}
                onChange={setNumber}
              />
            </Box>
          )}

          {/* 3b. WEDGE — type and loft. At least one is required. */}
          {isWedge && (
            <Box>
              <FieldLabel>Wedge Type</FieldLabel>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 2 }}>
                {WEDGE_TYPES.map((wt) => {
                  const active = wedgeType === wt;
                  return (
                    <Chip
                      key={wt}
                      label={wt}
                      onClick={() => setWedgeType(active ? null : wt)}
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      sx={{ fontWeight: 700, minHeight: 40, minWidth: 56, fontSize: '0.95rem' }}
                    />
                  );
                })}
              </Box>
              <FieldLabel>Loft</FieldLabel>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mb: 1 }}>
                {COMMON_WEDGE_LOFTS.map((deg) => {
                  const active = loft === String(deg);
                  return (
                    <Chip
                      key={deg}
                      label={`${deg}°`}
                      onClick={() => setLoft(active ? '' : String(deg))}
                      color={active ? 'primary' : 'default'}
                      variant={active ? 'filled' : 'outlined'}
                      sx={{ fontWeight: 600, minHeight: 36 }}
                    />
                  );
                })}
              </Box>
              <TextField
                label="Custom loft"
                value={loft}
                onChange={(e) => setLoft(e.target.value)}
                placeholder="e.g. 56"
                type="number"
                inputProps={{ inputMode: 'decimal', step: '0.5', min: 0, max: 90 }}
                InputProps={{
                  endAdornment: <InputAdornment position="end">°</InputAdornment>
                }}
                helperText="Pick a type, a loft, or both — at least one is required."
              />
            </Box>
          )}

          {/* 4. MODEL (optional) */}
          <TextField
            label="Model (optional)"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="e.g. Paradym, Stealth 2, T100"
          />

          {/* 5. TYPICAL DISTANCE (optional) — drives club recommendation
              in the hole-tracking aim mode. Skip for putters. */}
          {category !== 'putter' && (
            <TextField
              label="Typical distance (optional)"
              value={typicalDistance}
              onChange={(e) => {
                setDistanceTouched(true);
                setTypicalDistance(e.target.value);
              }}
              placeholder="e.g. 245"
              type="number"
              inputProps={{ inputMode: 'numeric', step: 1, min: 0 }}
              InputProps={{
                endAdornment: <InputAdornment position="end">yds</InputAdornment>
              }}
              helperText={
                mode === 'add' && skillLevel && gender && !distanceTouched
                  ? 'Suggested from your skill level — edit to override.'
                  : 'How far you typically hit this club. Used to suggest the right club while aiming.'
              }
            />
          )}

          {/* Live name preview */}
          <Box
            sx={{
              borderRadius: '5px',
              border: '1px dashed',
              borderColor: 'divider',
              p: 1.5,
              textAlign: 'center'
            }}
          >
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {mode === 'add' ? 'Adding' : 'Saving as'}
            </Typography>
            <Typography variant="h6" sx={{ fontWeight: 700, mt: 0.25 }}>
              {resolvedBrand ? `${resolvedBrand} ${previewName}` : previewName}
            </Typography>
            {model.trim() && (
              <Typography variant="caption" color="text.secondary">
                {model.trim()}
              </Typography>
            )}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" disabled={!canSubmit} onClick={submit}>
          {mode === 'add' ? 'Add Club' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        display: 'block',
        mb: 0.75
      }}
    >
      {children}
    </Typography>
  );
}

// ---------------------------------------------------------------------------
// Number boxes — large, tappable, grid of 4
// ---------------------------------------------------------------------------

function NumberBoxes({
  values,
  value,
  onChange
}: {
  values: number[];
  value: number | null;
  onChange: (n: number) => void;
}) {
  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 0.75
      }}
    >
      {values.map((n) => {
        const active = value === n;
        return (
          <Button
            key={n}
            onClick={() => onChange(n)}
            variant={active ? 'contained' : 'outlined'}
            sx={{
              minHeight: 56,
              fontSize: '1.25rem',
              fontWeight: 800,
              borderRadius: '5px',
              p: 0
            }}
          >
            {n}
          </Button>
        );
      })}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Quick add (unchanged behavior)
// ---------------------------------------------------------------------------

interface QuickAddDialogProps {
  open: boolean;
  existing: BagClub[];
  onClose: () => void;
  onSubmit: (clubs: Array<{ name: string; category: ClubCategory }>) => void;
}

function QuickAddDialog({ open, existing, onClose, onSubmit }: QuickAddDialogProps) {
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const grouped = DEFAULT_BAG.reduce<Record<ClubCategory, typeof DEFAULT_BAG>>((acc, club) => {
    if (!acc[club.category]) acc[club.category] = [];
    acc[club.category].push(club);
    return acc;
  }, {} as Record<ClubCategory, typeof DEFAULT_BAG>);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const submit = () => {
    const picks = DEFAULT_BAG.filter((c) => selected.has(c.name));
    onSubmit(picks);
    setSelected(new Set());
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      TransitionProps={{ onExited: () => setSelected(new Set()) }}
      PaperProps={{ sx: { borderRadius: '5px' } }}
    >
      <DialogTitle>Quick add clubs</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Tap the clubs you actually carry. Already in your bag are dimmed. You can add brand and
          model later by tapping the edit icon.
        </Typography>
        <Stack spacing={1.5}>
          {(Object.entries(grouped) as Array<[ClubCategory, typeof DEFAULT_BAG]>).map(([cat, clubs]) => (
            <Box key={cat}>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
              >
                {CATEGORY_LABELS[cat]}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 0.5 }}>
                {clubs.map((c) => {
                  const already = existingNames.has(c.name.toLowerCase());
                  const isSelected = selected.has(c.name);
                  return (
                    <Chip
                      key={c.name}
                      label={c.name}
                      onClick={already ? undefined : () => toggle(c.name)}
                      color={isSelected ? 'primary' : 'default'}
                      variant={isSelected ? 'filled' : 'outlined'}
                      disabled={already}
                      sx={{ fontWeight: 600, minHeight: 36, opacity: already ? 0.5 : 1 }}
                    />
                  );
                })}
              </Box>
            </Box>
          ))}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={submit} disabled={selected.size === 0}>
          Add {selected.size > 0 ? `${selected.size} club${selected.size === 1 ? '' : 's'}` : ''}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void;
}

function ConfirmDialog({ open, title, body, confirmLabel, onClose, onConfirm }: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs" PaperProps={{ sx: { borderRadius: '5px' } }}>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          {body}
        </Typography>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" color="error" onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
