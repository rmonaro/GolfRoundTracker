import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  InputAdornment,
  Stack,
  SwipeableDrawer,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { metersToYards } from '@/services/gpsService';
import type {
  BagClub,
  ClubCategory,
  DistanceUnit,
  Lie,
  PenaltyType,
  ShotResult,
  TargetResult,
  TargetType
} from '@/models';

/**
 * Tier-1 buckets shown above the club sub-list — 5 buttons in one row.
 * Hybrids ride in the "wood" bucket (commonly called rescue woods).
 */
export type ClubTier1 = 'driver' | 'wood' | 'iron' | 'wedge' | 'putter';

const TIER1_CATEGORIES: Record<ClubTier1, ClubCategory[]> = {
  driver: ['driver'],
  wood: ['wood', 'hybrid'],
  iron: ['iron'],
  wedge: ['wedge'],
  putter: ['putter']
};

const TIER1_LABELS: Record<ClubTier1, string> = {
  driver: 'Driver',
  wood: 'Wood',
  iron: 'Iron',
  wedge: 'Wedge',
  putter: 'Putter'
};

const TIER1_ICONS: Record<ClubTier1, React.ComponentType<{ size?: number }>> = {
  driver: DriverIcon,
  wood: WoodIcon,
  iron: IronIcon,
  wedge: WedgeIcon,
  putter: PutterIcon
};

const TIER1_ORDER: ClubTier1[] = ['driver', 'wood', 'iron', 'wedge', 'putter'];

export function tier1ForCategory(cat: ClubCategory): ClubTier1 {
  if (cat === 'driver') return 'driver';
  if (cat === 'wood' || cat === 'hybrid') return 'wood';
  if (cat === 'wedge') return 'wedge';
  if (cat === 'putter') return 'putter';
  return 'iron';
}

/** Tier-1 buckets that auto-select on tap (single-club groups). */
const TIER1_DIRECT_SELECT: ReadonlySet<ClubTier1> = new Set(['driver', 'putter']);
import {
  BullseyeTarget,
  FairwaySelector,
  GREEN_TARGET_PRESET,
  LieSelector,
  PenaltySelector,
  PUTT_TARGET_PRESET
} from './ShotSelectors';
import {
  DriverIcon,
  IronIcon,
  PutterIcon,
  WedgeIcon,
  WoodIcon
} from './ClubIcons';

/**
 * Bottom-sheet "Add Shot" modal — mobile-first.
 *
 * V1 captures: club, manual distance, distance unit, target_type + target_result,
 * lie, optional notes. Legacy shot_result is derived for backwards compat.
 *
 * V2 GPS HOOK POINTS (see also migration 004 + 005):
 *   • startLocation  — capture lat/lng when user taps "Start Shot" instead of
 *                       picking a club first.
 *   • endLocation    — capture lat/lng when user taps "End Shot" / arrives at ball.
 *   • calculatedDistance — derive from start/end via haversine; replaces manual entry.
 *   • clubAverageDistance — show "Your avg 7-Iron: 155 yds" inline under the club chip.
 */

/** Optional pre-fill data — when present the sheet runs in "edit" mode. */
export interface ShotEditDraft {
  clubId: string | null;
  distance: number | null;
  distanceUnit: DistanceUnit | null;
  targetType: TargetType | null;
  targetResult: TargetResult | null;
  lie: Lie | null;
  penaltyType: PenaltyType | null;
  notes: string | null;
  /** V2 GPS — included so editing a GPS-tracked shot preserves the original capture. */
  startLat?: number | null;
  startLng?: number | null;
  endLat?: number | null;
  endLng?: number | null;
  calculatedDistance?: number | null;
}

interface AddShotSheetProps {
  open: boolean;
  /** Number to label this shot in the sheet title. */
  shotNumber: number;
  /** When set, the sheet pre-fills from this draft and the parent should treat submit as an update. */
  editing?: ShotEditDraft | null;
  /** Par for the hole being played — drives target selector mode for the tee shot. */
  holePar: number;
  bagClubs: BagClub[];
  /**
   * Optional pre-selected club for a NEW shot (ignored in edit mode). The
   * sheet sets clubId + tier1 accordingly when it opens. Use case: after the
   * previous shot landed on the green, HoleTrackingPage passes the putter id
   * so the user doesn't have to re-tap the putter tier every putt.
   */
  defaultClubId?: string | null;
  /**
   * Optional pre-captured GPS for a NEW shot. When set, the sheet seeds the
   * distance input from `calculatedDistance` (converted to yards) and stashes
   * start/end coords + calculated distance for the eventual save. Used by the
   * on-course Track button — capture happens on the hole screen, the sheet
   * just collects the rest of the shot info.
   */
  defaultGps?: {
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    calculatedDistanceM: number;
    /**
     * Optional pre-classified outcome from the map-tap flow. The HoleLayout
     * map ray-casts the tap against course feature polygons (green/bunker/
     * fairway/etc.) and the green-relative bearing, then ships the result
     * here so the user opens the sheet with the right tier-2/lie already
     * highlighted. Both can be null when the GPS came from Track-button
     * capture (no map context).
     */
    inferredLie?: Lie | null;
    inferredTargetResult?: TargetResult | null;
  } | null;
  onClose: () => void;
  onSubmit: (payload: {
    clubId: string | null;
    clubCategory: ClubCategory | null;
    distance: number | null;
    distanceUnit: DistanceUnit | null;
    targetType: TargetType;
    targetResult: TargetResult;
    lie: Lie | null;
    penaltyType: PenaltyType | null;
    /** Legacy single-field shot_result derived from the above. */
    derivedShotResult: ShotResult;
    notes: string | null;
    /** V2 GPS fields — null when the user didn't engage GPS capture. */
    startLat: number | null;
    startLng: number | null;
    endLat: number | null;
    endLng: number | null;
    calculatedDistance: number | null;
  }) => void;
}

/**
 * Decide which target selector to show.
 *  - Putter selected (any shot)  → putting selector
 *  - Shot #1 on a Par 3          → green target
 *  - Shot #1 on a Par 4 / Par 5  → fairway selector
 *  - Any shot after the tee      → green target
 */
function pickTargetType(
  shotNumber: number,
  holePar: number,
  club: BagClub | null
): TargetType {
  if (club?.category === 'putter') return 'putt';
  if (shotNumber === 1 && holePar !== 3) return 'fairway';
  return 'green';
}

/** Map structured outcome back to the legacy shot_result enum. */
function deriveShotResult(
  targetType: TargetType,
  targetResult: TargetResult,
  lie: Lie | null,
  penaltyType: PenaltyType | null
): ShotResult {
  // Any stroke-adding penalty trumps everything for handicap math.
  const isStrokePenalty =
    penaltyType !== null && penaltyType !== 'bunker';
  if (isStrokePenalty || lie === 'penalty') return 'penalty';

  if (targetType === 'putt') {
    return targetResult === 'made' ? 'made_putt' : 'putt';
  }
  if (targetType === 'green') {
    if (targetResult === 'hit') return 'green';
    return targetResult as ShotResult;
  }
  if (targetResult === 'hit') return 'fairway';
  return targetResult as ShotResult;
}

export function AddShotSheet({
  open,
  shotNumber,
  editing,
  holePar,
  bagClubs,
  defaultClubId,
  defaultGps,
  onClose,
  onSubmit
}: AddShotSheetProps) {
  const [clubId, setClubId] = useState<string | null>(null);
  const [tier1, setTier1] = useState<ClubTier1 | null>(null);
  const [clubPickerOpen, setClubPickerOpen] = useState(false);
  const [distance, setDistance] = useState<string>('');
  const [unit, setUnit] = useState<DistanceUnit>('yards');
  const [targetResult, setTargetResult] = useState<TargetResult | null>(null);
  const [lie, setLie] = useState<Lie | null>(null);
  const [penaltyType, setPenaltyType] = useState<PenaltyType | null>(null);
  const [notes, setNotes] = useState<string>('');
  // V2 GPS — start position captured when user taps "Start GPS"; end position
  // captured automatically on submit if start is set. calculatedDistance is
  // populated on submit too and surfaced alongside the manual entry.
  const [startGps, setStartGps] = useState<{ lat: number; lng: number } | null>(null);
  const [endGps, setEndGps] = useState<{ lat: number; lng: number } | null>(null);
  const [calculatedDistance, setCalculatedDistance] = useState<number | null>(null);
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'capturing' | 'ready' | 'error'>('idle');
  const [gpsError, setGpsError] = useState<string | null>(null);

  const selectedClub = bagClubs.find((c) => c.clubId === clubId) ?? null;
  const targetType = useMemo(
    () => pickTargetType(shotNumber, holePar, selectedClub),
    [shotNumber, holePar, selectedClub]
  );

  // On open: either pre-fill from an edit draft, or reset to a blank shot.
  useEffect(() => {
    if (!open) return;
    if (editing) {
      setClubId(editing.clubId);
      setTier1(
        editing.clubId
          ? (() => {
              const club = bagClubs.find((c) => c.clubId === editing.clubId);
              return club ? tier1ForCategory(club.category) : null;
            })()
          : null
      );
      setDistance(editing.distance != null ? String(editing.distance) : '');
      setUnit(editing.distanceUnit ?? 'yards');
      setTargetResult(editing.targetResult);
      setLie(editing.lie);
      setPenaltyType(editing.penaltyType);
      setNotes(editing.notes ?? '');
      // Pre-fill GPS from the edit draft so re-submission preserves the
      // original capture (we don't re-capture on edit).
      setStartGps(
        editing.startLat != null && editing.startLng != null
          ? { lat: editing.startLat, lng: editing.startLng }
          : null
      );
      setEndGps(
        editing.endLat != null && editing.endLng != null
          ? { lat: editing.endLat, lng: editing.endLng }
          : null
      );
      setCalculatedDistance(editing.calculatedDistance ?? null);
      setGpsStatus(editing.startLat != null ? 'ready' : 'idle');
      setGpsError(null);
    } else {
      // New shot. Apply optional defaultClubId (e.g. putter after on-green
      // shot) so the user opens straight to the relevant selectors.
      const defaultClub = defaultClubId
        ? bagClubs.find((c) => c.clubId === defaultClubId) ?? null
        : null;
      setClubId(defaultClub?.clubId ?? null);
      setTier1(defaultClub ? tier1ForCategory(defaultClub.category) : null);
      // Seed distance from the pre-captured GPS (in yards) when provided —
      // user can still override.
      if (defaultGps) {
        const yds = Math.round(metersToYards(defaultGps.calculatedDistanceM));
        setDistance(String(yds));
        setUnit('yards');
        setStartGps({ lat: defaultGps.startLat, lng: defaultGps.startLng });
        setEndGps({ lat: defaultGps.endLat, lng: defaultGps.endLng });
        setCalculatedDistance(defaultGps.calculatedDistanceM);
        setGpsStatus('ready');
      } else {
        setDistance('');
        setUnit(defaultClub?.category === 'putter' ? 'feet' : 'yards');
        setStartGps(null);
        setEndGps(null);
        setCalculatedDistance(null);
        setGpsStatus('idle');
      }
      // Seed from the map-tap classification when present. Putt mode is the
      // exception: the putt UI uses a different TargetResult vocabulary (made/
      // long/short/left/right with its own selector) and infers lie itself, so
      // we leave both null and let the user pick.
      const isPuttDefault = defaultClub?.category === 'putter';
      setTargetResult(
        !isPuttDefault && defaultGps?.inferredTargetResult
          ? defaultGps.inferredTargetResult
          : null
      );
      setLie(!isPuttDefault && defaultGps?.inferredLie ? defaultGps.inferredLie : null);
      setPenaltyType(null);
      setNotes('');
      setGpsError(null);
    }
    // bagClubs reference can change as the bag hydrates; we intentionally only re-run
    // when `open` or `editing` flips. Including bagClubs would re-reset mid-edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editing]);

  // Smart defaults when the club changes.
  useEffect(() => {
    if (!selectedClub) return;
    if (selectedClub.category === 'putter') {
      setUnit('feet');
      // Clear any non-putt target_result the user might have picked before swapping club.
      setTargetResult((r) =>
        r === 'made' || r === 'left' || r === 'right' || r === 'short' || r === 'long' ? r : null
      );
    } else {
      setUnit((u) => (u === 'feet' ? 'yards' : u));
      // 'made' only applies to putts; clear it if the club is no longer a putter.
      setTargetResult((r) => (r === 'made' ? null : r));
    }
  }, [selectedClub]);

  // When the user taps the ideal target, sync the lie to match — fairway-hit
  // → fairway, green-hit → green, putt-made → green. This fires whenever the
  // user changes their target pick, so re-tapping fairway after manually
  // setting lie to 'rough' still updates lie back to 'fairway'. `lie` is
  // NOT in the deps — that way, a user edit to the lie selector AFTER the
  // auto-set sticks (we don't re-fire on every lie change and overwrite it).
  useEffect(() => {
    if (!targetResult) return;
    if (targetType === 'green' && targetResult === 'hit') setLie('green');
    else if (targetType === 'fairway' && targetResult === 'hit') setLie('fairway');
    else if (targetType === 'putt' && targetResult === 'made') setLie('green');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetResult, targetType]);

  const distanceNumber = distance.trim() === '' ? null : Number(distance);
  const distanceValid =
    distanceNumber == null ||
    (Number.isFinite(distanceNumber) && distanceNumber >= 0 && distanceNumber <= 999);
  const canSubmit = clubId !== null && targetResult !== null && distanceValid;

  const submit = () => {
    if (!canSubmit || !targetResult) return;
    const derivedShotResult = deriveShotResult(targetType, targetResult, lie, penaltyType);
    onSubmit({
      clubId,
      clubCategory: selectedClub?.category ?? null,
      distance: distanceNumber,
      distanceUnit: distanceNumber == null ? null : unit,
      targetType,
      targetResult,
      lie,
      penaltyType,
      derivedShotResult,
      notes: notes.trim() || null,
      startLat: startGps?.lat ?? null,
      startLng: startGps?.lng ?? null,
      endLat: endGps?.lat ?? null,
      endLng: endGps?.lng ?? null,
      calculatedDistance
    });
  };

  return (
    <SwipeableDrawer
      anchor="bottom"
      open={open}
      onClose={onClose}
      onOpen={() => {}}
      disableSwipeToOpen
      keepMounted={false}
      PaperProps={{
        sx: {
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          maxHeight: '94dvh',
          pb: 'env(safe-area-inset-bottom)'
        }
      }}
    >
      {/* Drag handle */}
      <Box sx={{ display: 'grid', placeItems: 'center', pt: 1.5, pb: 0.5 }}>
        <Box sx={{ width: 44, height: 4, borderRadius: 999, bgcolor: 'action.selected' }} />
      </Box>

      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, pt: 1 }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            {editing ? `Edit Shot ${shotNumber}` : `Shot ${shotNumber}`}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {describeShotContext(shotNumber, holePar, targetType)}
          </Typography>
        </Box>
        <IconButton aria-label="close" onClick={onClose}>
          <CloseRoundedIcon />
        </IconButton>
      </Stack>

      <Box sx={{ px: 2, pb: 2, overflowY: 'auto', flex: 1 }}>
        {/* Top row: 33% Club + Distance stacked on the left, 67% Target on
            the right. The club appears as a compact button — pre-selected
            when the caller passed a `defaultClubId` (e.g. from the main-screen
            club picker), or showing "Select Club" otherwise. Tapping opens a
            sub-dialog with the full tier-1 / tier-2 ClubPicker. */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: '33% 1fr',
            columnGap: 1.5,
            mb: 2
          }}
        >
          {/* LEFT COLUMN — Club + Distance stacked */}
          <Stack spacing={1.25}>
            <Box>
              <SectionLabel>Club</SectionLabel>
              {bagClubs.length === 0 ? (
                <Typography variant="caption" color="text.secondary">
                  Add clubs in My Bag.
                </Typography>
              ) : (
                <Button
                  fullWidth
                  variant={selectedClub ? 'contained' : 'outlined'}
                  startIcon={<SportsGolfRoundedIcon />}
                  onClick={() => setClubPickerOpen(true)}
                  sx={{
                    minHeight: 56,
                    textTransform: 'none',
                    fontWeight: 700,
                    justifyContent: 'flex-start',
                    px: 1.25,
                    '& .MuiButton-startIcon': { mr: 0.75 }
                  }}
                >
                  <Box
                    component="span"
                    sx={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap'
                    }}
                  >
                    {selectedClub
                      ? selectedClub.customName || selectedClub.name
                      : 'Select Club'}
                  </Box>
                </Button>
              )}
            </Box>

            {/* Distance — GPS hint sits above the field when seeded. */}
            <Box>
              <SectionLabel>Distance</SectionLabel>
              {calculatedDistance != null && (
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ display: 'block', mb: 0.5 }}
                >
                  GPS: {Math.round(metersToYards(calculatedDistance))} yds
                </Typography>
              )}
              <Stack direction="row" spacing={0.5} alignItems="stretch">
                <TextField
                  value={distance}
                  onChange={(e) => setDistance(e.target.value)}
                  placeholder="0"
                  type="number"
                  inputMode="decimal"
                  inputProps={{ inputMode: 'decimal', step: '0.5', min: 0, max: 999 }}
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        {unit === 'feet' ? 'ft' : 'yds'}
                      </InputAdornment>
                    )
                  }}
                  error={!distanceValid}
                  sx={{ flex: 1, minWidth: 0 }}
                />
              </Stack>
              <ToggleButtonGroup
                exclusive
                value={unit}
                onChange={(_, v) => v && setUnit(v as DistanceUnit)}
                fullWidth
                size="small"
                sx={{
                  mt: 0.5,
                  '& .MuiToggleButton-root': {
                    minHeight: 32,
                    fontWeight: 700,
                    textTransform: 'none'
                  },
                  '& .Mui-selected': {
                    bgcolor: 'primary.main',
                    color: 'primary.contrastText',
                    '&:hover': { bgcolor: 'primary.dark' }
                  }
                }}
              >
                <ToggleButton value="yards">yds</ToggleButton>
                <ToggleButton value="feet">ft</ToggleButton>
              </ToggleButtonGroup>
              {!distanceValid && (
                <Typography
                  variant="caption"
                  color="error"
                  sx={{ display: 'block', mt: 0.5 }}
                >
                  0–999 only
                </Typography>
              )}
            </Box>
          </Stack>

          {/* RIGHT COLUMN — Target */}
          <Box>
            <SectionLabel>{targetSectionLabel(targetType)}</SectionLabel>
            {targetType === 'fairway' && (
              <FairwaySelector value={targetResult} onChange={setTargetResult} />
            )}
            {targetType === 'green' && (
              <BullseyeTarget
                value={targetResult}
                onChange={setTargetResult}
                {...GREEN_TARGET_PRESET}
                centerVariant="green"
              />
            )}
            {targetType === 'putt' && (
              <BullseyeTarget
                value={targetResult}
                onChange={setTargetResult}
                {...PUTT_TARGET_PRESET}
                centerVariant="success"
              />
            )}
          </Box>
        </Box>

        <Divider sx={{ mb: 2 }} />

        {/* 4. LIE — hidden for putts by default (you're on the green). Reappears
            when the putt overshoots ("Long"), with `green` swapped for `fringe`
            since the ball ended up off the back of the green. */}
        {(targetType !== 'putt' || targetResult === 'long') && (
          <>
            <SectionLabel>4. Lie (optional)</SectionLabel>
            <Box sx={{ mb: 2 }}>
              <LieSelector
                value={lie}
                onChange={setLie}
                options={
                  targetType === 'putt' && targetResult === 'long'
                    ? (['fairway', 'rough', 'bunker', 'fringe', 'penalty'] as const)
                    : undefined
                }
              />
            </Box>
            <Divider sx={{ mb: 2 }} />
          </>
        )}

        {/* 5. PENALTY — hidden for putts entirely. Penalties on the green don't
            make sense in V1's data model (no greenside OB/water tracking from
            here). */}
        {targetType !== 'putt' && (
          <>
            <SectionLabel>5. Penalty (optional)</SectionLabel>
            <Box sx={{ mb: 1 }}>
              <PenaltySelector value={penaltyType} onChange={setPenaltyType} />
            </Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 2 }}
            >
              OB, Water, Lost Ball, Unplayable, and Wrong Ball each add 1 stroke to the
              hole. Bunker is a tag only.
            </Typography>
            <Divider sx={{ mb: 2 }} />
          </>
        )}

        {/* 6. NOTES */}
        <SectionLabel>6. Notes (optional)</SectionLabel>
        <TextField
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Hooked left, chunked wedge…"
          multiline
          minRows={2}
          fullWidth
        />
      </Box>

      <Box
        sx={{
          p: 2,
          pt: 1,
          borderTop: 1,
          borderColor: 'divider',
          bgcolor: 'background.paper'
        }}
      >
        <Button
          variant="contained"
          fullWidth
          size="large"
          disabled={!canSubmit}
          onClick={submit}
          sx={{ minHeight: 56, fontSize: '1.05rem', fontWeight: 700 }}
        >
          {editing ? 'Update Shot' : 'Save Shot'}
        </Button>
      </Box>

      {/* Nested club picker — MUI Dialog portals to document.body so it sits
          above the SwipeableDrawer correctly. Auto-closes when the user
          commits to a leaf club. Tier-1 taps that expand a multi-club group
          keep the dialog open so the user can drill in. */}
      <Dialog
        open={clubPickerOpen}
        onClose={() => setClubPickerOpen(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle
          sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 1 }}
        >
          Pick a club
          <IconButton size="small" onClick={() => setClubPickerOpen(false)}>
            <CloseRoundedIcon />
          </IconButton>
        </DialogTitle>
        <DialogContent dividers>
          {bagClubs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No clubs in your bag yet — add some in My Bag.
            </Typography>
          ) : (
            <ClubPicker
              bagClubs={bagClubs}
              clubId={clubId}
              tier1={tier1}
              onChange={(nextClubId, nextTier1) => {
                setClubId(nextClubId);
                setTier1(nextTier1);
                if (nextClubId) setClubPickerOpen(false);
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </SwipeableDrawer>
  );
}

function describeShotContext(shotNumber: number, holePar: number, targetType: TargetType): string {
  if (targetType === 'putt') return 'Putt';
  if (shotNumber === 1) return holePar === 3 ? 'Tee shot · Par 3' : `Tee shot · Par ${holePar}`;
  return `Approach shot · Par ${holePar}`;
}

function targetSectionLabel(targetType: TargetType): string {
  if (targetType === 'fairway') return 'Fairway target';
  if (targetType === 'putt') return 'Putting result';
  return 'Green target';
}

// ---------------------------------------------------------------------------
// ClubPicker — 4 tier-1 buttons + conditional tier-2 chip row
// ---------------------------------------------------------------------------

interface ClubPickerProps {
  bagClubs: BagClub[];
  clubId: string | null;
  tier1: ClubTier1 | null;
  onChange: (clubId: string | null, tier1: ClubTier1 | null) => void;
}

export function ClubPicker({ bagClubs, clubId, tier1, onChange }: ClubPickerProps) {
  const sortedBag = [...bagClubs].sort((a, b) => a.orderPosition - b.orderPosition);

  const groups: Record<ClubTier1, BagClub[]> = {
    driver: [],
    wood: [],
    iron: [],
    wedge: [],
    putter: []
  };
  for (const club of sortedBag) {
    groups[tier1ForCategory(club.category)].push(club);
  }

  const selectedClub = bagClubs.find((c) => c.clubId === clubId) ?? null;
  const effectiveTier1: ClubTier1 | null =
    tier1 ?? (selectedClub ? tier1ForCategory(selectedClub.category) : null);

  const tapTier1 = (group: ClubTier1) => {
    const clubs = groups[group];
    if (clubs.length === 0) return;
    if (TIER1_DIRECT_SELECT.has(group)) {
      // Single-club groups (Driver / Putter) — auto-select the first club in bag order.
      onChange(clubs[0].clubId, group);
      return;
    }
    // Multi-club groups (Wood / Iron / Wedge) — expand sub-list.
    // Preserve the existing selection only if it still belongs to this group.
    const keep =
      selectedClub && groups[group].some((c) => c.clubId === selectedClub.clubId)
        ? selectedClub.clubId
        : null;
    onChange(keep, group);
  };

  const tier2Clubs =
    effectiveTier1 && !TIER1_DIRECT_SELECT.has(effectiveTier1)
      ? groups[effectiveTier1]
      : null;

  return (
    <Box sx={{ mb: 2 }}>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: 0.5,
          mb: tier2Clubs ? 1.5 : 0
        }}
      >
        {TIER1_ORDER.map((group) => {
          const Icon = TIER1_ICONS[group];
          return (
            <Tier1Tile
              key={group}
              icon={<Icon size={24} />}
              label={TIER1_LABELS[group]}
              active={effectiveTier1 === group}
              disabled={groups[group].length === 0}
              onClick={() => tapTier1(group)}
            />
          );
        })}
      </Box>

      {tier2Clubs && (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0.75,
            px: 0.75,
            py: 1,
            borderRadius: 2,
            bgcolor: 'action.hover'
          }}
        >
          {tier2Clubs.length === 0 ? (
            <Typography variant="caption" color="text.secondary" sx={{ p: 1 }}>
              No clubs in this group — add some in My Bag.
            </Typography>
          ) : (
            tier2Clubs.map((club) => {
              const active = clubId === club.clubId;
              return (
                <Chip
                  key={club.bagId}
                  label={club.customName || club.name}
                  onClick={() => onChange(club.clubId, effectiveTier1)}
                  color={active ? 'primary' : 'default'}
                  variant={active ? 'filled' : 'outlined'}
                  sx={{ fontWeight: 600, minHeight: 36, fontSize: '0.9rem' }}
                />
              );
            })
          )}
        </Box>
      )}
    </Box>
  );
}

function Tier1Tile({
  icon,
  label,
  active,
  disabled,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.5 }}>
      <Box
        component="button"
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        sx={{
          aspectRatio: '1 / 1',
          width: '100%',
          borderRadius: '50%',
          border: '2px solid',
          borderColor: active ? 'primary.main' : 'divider',
          bgcolor: active ? 'primary.main' : 'background.paper',
          color: active ? 'primary.contrastText' : 'text.primary',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.35 : 1,
          display: 'grid',
          placeItems: 'center',
          padding: 0,
          fontFamily: 'inherit',
          transition: 'all 120ms ease',
          '&:hover:not(:disabled)': {
            borderColor: active ? 'primary.dark' : 'text.secondary',
            transform: 'scale(1.04)'
          },
          '&:focus-visible': {
            outline: '2px solid',
            outlineColor: 'primary.main',
            outlineOffset: 2
          }
        }}
      >
        {icon}
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 700,
          fontSize: '0.72rem',
          lineHeight: 1,
          color: active ? 'text.primary' : 'text.secondary',
          userSelect: 'none'
        }}
      >
        {label}
      </Typography>
    </Box>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        textTransform: 'uppercase',
        letterSpacing: 0.6,
        display: 'block',
        mb: 1,
        fontWeight: 700,
        mt: 1
      }}
    >
      {children}
    </Typography>
  );
}

// Re-exported so callers (e.g. ShotRow in the timeline) get the same label dictionary.
export const RESULT_LABELS: Record<ShotResult, string> = {
  fairway: 'Fairway',
  rough: 'Rough',
  green: 'Green',
  sand: 'Sand',
  left: 'Left',
  right: 'Right',
  short: 'Short',
  long: 'Long',
  penalty: 'Penalty',
  putt: 'Putt',
  made_putt: 'Made',
  recovery: 'Recovery'
};
