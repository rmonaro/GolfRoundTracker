import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
import StarRoundedIcon from '@mui/icons-material/StarRounded';
import StarOutlineRoundedIcon from '@mui/icons-material/StarOutlineRounded';
import NearMeRoundedIcon from '@mui/icons-material/NearMeRounded';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { useCourses } from '@/features/round/useStartRound';
import { useSearchCourses, useImportCourse } from '@/admin/hooks/useCoursesApi';
import { useAuthStore } from '@/stores/authStore';
import { useCourseFavoritesStore } from '@/stores/courseFavoritesStore';
import { useCourseLocation } from '@/features/round/useCourseLocation';
import { formatCourseDistance, rankCourses } from '@/features/round/courseRanking';
import type { Course } from '@/models';

/** Rows rendered before the "show more" button appears. */
const PAGE_SIZE = 50;

// Every move WITHIN the start-a-round flow replaces the current history entry
// rather than pushing, so the three screens together occupy exactly one entry
// sitting on top of /round. That's what makes backing out of the round land on
// the round home instead of dropping the golfer into the course picker they
// just came through — and it holds however many times they bounce between the
// picker and the setup screen before committing.
const WITHIN_FLOW = { replace: true } as const;

/**
 * Step 1 of starting a round: pick the course.
 *
 * Search at the top, then every course the golfer can play, nearest first with
 * starred ones above. Choosing one moves to `/round/start/:courseId`, where the
 * tee and hole count are set — the two decisions that need the course to be
 * known. Hand-entering a course is its own screen off the bottom of this one.
 */
export function StartRoundPage() {
  const navigate = useNavigate();
  const courses = useCourses();
  const [search, setSearch] = useState('');

  const favoriteIds = useCourseFavoritesStore((s) => s.favoriteIds);
  const toggleFavorite = useCourseFavoritesStore((s) => s.toggleFavorite);
  const location = useCourseLocation();

  const ranked = useMemo(
    () =>
      rankCourses(courses.data ?? [], {
        favorites: favoriteIds,
        origin: location.origin,
        search
      }),
    [courses.data, favoriteIds, location.origin, search]
  );

  // How many rows are actually rendered. Reset whenever the query changes so a
  // new search starts from the top of its own results.
  const [shown, setShown] = useState(PAGE_SIZE);
  useEffect(() => setShown(PAGE_SIZE), [search]);
  const visible = ranked.slice(0, shown);

  return (
    <Box>
      {/* Header and search pin together as ONE block. Two sibling sticky
          elements would both stop at top: 0 and overlap; nesting the header
          inside the pinned wrapper keeps the search bar visible however far
          down the list the golfer scrolls. */}
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: (t) => t.zIndex.appBar,
          bgcolor: 'background.default'
        }}
      >
        <PageHeader title="Start Round" subtitle="Pick your course" back />
        <Box sx={{ px: 2, pb: 1.5 }}>
          <TextField
            placeholder="Search courses"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            fullWidth
            autoComplete="off"
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                )
              }
            }}
          />
        </Box>
      </Box>

      <Stack spacing={1.5} px={2} pb={4}>
        <LocationNotice location={location} />

        {courses.isLoading && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {!courses.isLoading && ranked.length === 0 && (
          <Box sx={{ py: 4, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {search.trim()
                ? `No saved courses match "${search.trim()}".`
                : 'No courses yet.'}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {search.trim()
                ? 'Try the online search below, or add it by hand.'
                : 'Search online for one, or add it by hand.'}
            </Typography>
          </Box>
        )}

        {/* The list itself grows the page — the page scrolls, the list doesn't
            get its own inner scroller. A nested scroll area inside a scrolling
            page is the thing that makes a phone list feel broken. */}
        <Stack spacing={1}>
          {visible.map(({ course, distanceMeters, favorite }) => (
            <CourseRow
              key={course.id}
              course={course}
              distanceLabel={formatCourseDistance(distanceMeters)}
              favorite={favorite}
              onToggleFavorite={() => toggleFavorite(course.id)}
              onSelect={() => navigate(`/round/start/${course.id}`, WITHIN_FLOW)}
            />
          ))}
        </Stack>

        {/* The library is shared across every user, so it can grow well past
            what's worth putting in the DOM at once. The cap is stated rather
            than silent — with the list already sorted nearest-first, the ones
            beyond it are the ones the golfer is furthest from. */}
        {ranked.length > shown && (
          <Button
            variant="text"
            onClick={() => setShown((n) => n + PAGE_SIZE)}
            sx={{ minHeight: 44 }}
          >
            Show {Math.min(PAGE_SIZE, ranked.length - shown)} more of{' '}
            {ranked.length - shown}
          </Button>
        )}

        <OnlineCourseSearch
          search={search}
          localCourses={courses.data ?? []}
          onImported={(courseId) => navigate(`/round/start/${courseId}`, WITHIN_FLOW)}
        />

        <Button
          variant="outlined"
          startIcon={<AddRoundedIcon />}
          onClick={() =>
            navigate(
              search.trim()
                ? `/round/start/manual?name=${encodeURIComponent(search.trim())}`
                : '/round/start/manual',
              WITHIN_FLOW
            )
          }
          sx={{ minHeight: 48, mt: 1 }}
        >
          {search.trim() ? `Add "${search.trim()}" manually` : 'Add a course manually'}
        </Button>
      </Stack>
    </Box>
  );
}

/**
 * One course in the list. The star is a real button sitting beside — not
 * inside — the row's action area: nesting it would make favouriting also
 * select the course.
 */
function CourseRow({
  course,
  distanceLabel,
  favorite,
  onToggleFavorite,
  onSelect
}: {
  course: Course;
  distanceLabel: string | null;
  favorite: boolean;
  onToggleFavorite: () => void;
  onSelect: () => void;
}) {
  const subtitle = [course.club_name, [course.city, course.state].filter(Boolean).join(', ')]
    .filter(Boolean)
    .join(' · ');

  return (
    <Card
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        border: 1,
        borderColor: favorite ? 'primary.main' : 'divider',
        borderRadius: '5px',
        display: 'flex',
        alignItems: 'stretch'
      }}
    >
      <CardActionArea onClick={onSelect} sx={{ flex: 1, minWidth: 0 }}>
        <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
          <Stack direction="row" alignItems="center" spacing={1}>
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Stack direction="row" alignItems="center" spacing={0.75}>
                <Typography variant="body1" sx={{ fontWeight: 600 }} noWrap>
                  {course.name}
                </Typography>
                {course.verified && (
                  <VerifiedRoundedIcon
                    color="primary"
                    sx={{ fontSize: 16, flexShrink: 0 }}
                    aria-label="Verified course"
                  />
                )}
              </Stack>
              {subtitle && (
                <Typography variant="caption" color="text.secondary" noWrap display="block">
                  {subtitle}
                </Typography>
              )}
            </Box>
            {distanceLabel && (
              <Chip
                size="small"
                icon={<NearMeRoundedIcon sx={{ fontSize: 14 }} />}
                label={distanceLabel}
                sx={{
                  flexShrink: 0,
                  height: 24,
                  fontWeight: 700,
                  '.MuiChip-label': { px: 0.75, fontSize: '0.72rem' }
                }}
              />
            )}
          </Stack>
        </CardContent>
      </CardActionArea>
      <IconButton
        onClick={onToggleFavorite}
        aria-label={favorite ? `Unfavorite ${course.name}` : `Favorite ${course.name}`}
        aria-pressed={favorite}
        sx={{ alignSelf: 'center', mr: 0.5, color: favorite ? 'warning.main' : 'text.disabled' }}
      >
        {favorite ? <StarRoundedIcon /> : <StarOutlineRoundedIcon />}
      </IconButton>
    </Card>
  );
}

/** Inline explanation of why distances are (or aren't) showing. */
function LocationNotice({ location }: { location: ReturnType<typeof useCourseLocation> }) {
  if (location.status === 'ready' || location.status === 'unavailable') return null;

  if (location.status === 'locating') {
    return (
      <Stack direction="row" alignItems="center" spacing={1} sx={{ px: 0.5 }}>
        <CircularProgress size={14} />
        <Typography variant="caption" color="text.secondary">
          Finding you, to sort by distance…
        </Typography>
      </Stack>
    );
  }

  // 'off' — the GPS opt-in is what stops the app asking for location before the
  // user wants it, so this is a prompt rather than an automatic request.
  if (location.status === 'off') {
    return (
      <Alert
        severity="info"
        variant="outlined"
        sx={{ borderRadius: '5px' }}
        action={
          <Button size="small" onClick={location.enableAndLocate}>
            Turn on
          </Button>
        }
      >
        Turn on location to see how far each course is and put the closest first.
      </Alert>
    );
  }

  return (
    <Alert
      severity="warning"
      variant="outlined"
      sx={{ borderRadius: '5px' }}
      action={
        <Button size="small" onClick={location.retry}>
          Retry
        </Button>
      }
    >
      Couldn't get your location — courses are listed alphabetically.
    </Alert>
  );
}

/**
 * GolfCourseAPI lookup for courses not in the library yet. Kept behind an
 * explicit button rather than firing as the golfer types, so the API key isn't
 * hammered on every keystroke.
 */
function OnlineCourseSearch({
  search,
  localCourses,
  onImported
}: {
  search: string;
  localCourses: Course[];
  onImported: (courseId: string) => void;
}) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  const searchOnline = useSearchCourses();
  const importCourse = useImportCourse();
  /** Which API row is mid-import, so only that one disables. */
  const [importingId, setImportingId] = useState<string | null>(null);

  const courseByApiId = useMemo(() => {
    const m = new Map<string, Course>();
    for (const c of localCourses) if (c.course_api_id) m.set(c.course_api_id, c);
    return m;
  }, [localCourses]);

  const query = search.trim();
  if (!query) return null;

  const onUse = (courseApiId: string) => {
    // Already in the library — no round-trip, just move on.
    const existing = courseByApiId.get(courseApiId);
    if (existing) {
      onImported(existing.id);
      return;
    }
    setImportingId(courseApiId);
    importCourse.mutate(courseApiId, {
      onSuccess: async (res) => {
        await queryClient.invalidateQueries({ queryKey: ['courses', userId] });
        setImportingId(null);
        onImported(res.course.id);
      },
      onError: () => setImportingId(null)
    });
  };

  return (
    <Box sx={{ pt: 1 }}>
      <Button
        variant="outlined"
        size="small"
        startIcon={<TravelExploreRoundedIcon />}
        onClick={() => searchOnline.mutate(query)}
        disabled={searchOnline.isPending}
        sx={{ minHeight: 40 }}
      >
        {searchOnline.isPending ? 'Searching online…' : `Search online for "${query}"`}
      </Button>

      {searchOnline.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {(searchOnline.error as Error).message}
        </Alert>
      )}
      {importCourse.error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {(importCourse.error as Error).message}
        </Alert>
      )}
      {searchOnline.data?.results.length === 0 && (
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
          No results from GolfCourseAPI.
        </Typography>
      )}

      {searchOnline.data && searchOnline.data.results.length > 0 && (
        <Stack spacing={1} sx={{ mt: 1 }}>
          <Typography
            variant="caption"
            color="text.secondary"
            sx={{ textTransform: 'uppercase', letterSpacing: 0.5 }}
          >
            Online results
          </Typography>
          {searchOnline.data.results.map((r) => {
            const alreadyHere = !!courseByApiId.get(r.courseApiId) || r.alreadyImported;
            const isImporting = importingId === r.courseApiId;
            const subtitle = [r.clubName, [r.city, r.state].filter(Boolean).join(', ')]
              .filter(Boolean)
              .join(' · ');
            return (
              <Card
                key={r.courseApiId}
                elevation={0}
                sx={{
                  bgcolor: 'background.default',
                  border: 1,
                  borderColor: 'divider',
                  borderRadius: '5px'
                }}
              >
                <CardContent sx={{ py: 1.25, '&:last-child': { pb: 1.25 } }}>
                  <Stack direction="row" alignItems="center" spacing={1} sx={{ minWidth: 0 }}>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="body1" sx={{ fontWeight: 500 }} noWrap>
                        {r.name}
                      </Typography>
                      {subtitle && (
                        <Typography variant="caption" color="text.secondary" noWrap display="block">
                          {subtitle}
                        </Typography>
                      )}
                    </Box>
                    <Button
                      variant={alreadyHere ? 'outlined' : 'contained'}
                      size="small"
                      disabled={isImporting}
                      onClick={() => onUse(r.courseApiId)}
                      sx={{ minHeight: 40, flexShrink: 0 }}
                    >
                      {isImporting ? 'Adding…' : alreadyHere ? 'Select' : 'Use'}
                    </Button>
                  </Stack>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Box>
  );
}
