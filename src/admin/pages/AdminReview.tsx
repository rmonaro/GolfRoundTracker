import { useState } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';
import { holesRepo } from '@/services/holesRepo';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';

type Filter = 'all' | 'assumed' | 'reversed';

export function AdminReview() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<Filter>('all');
  const [cursor, setCursor] = useState(0);
  const [previewFlip, setPreviewFlip] = useState(false);

  const { data: holes, isLoading } = useQuery({
    queryKey: ['admin-review-queue', filter],
    queryFn: () => adminCoursesRepo.listLowConfidenceHoles(filter)
  });

  const confirmMutation = useMutation({
    mutationFn: (holeId: string) => holesRepo.setOrientationConfirmed(holeId)
  });
  const flipMutation = useMutation({
    mutationFn: (holeId: string) => holesRepo.flipHole(holeId)
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!holes || holes.length === 0) {
    return (
      <Box sx={{ p: 4, textAlign: 'center' }}>
        <Typography color="text.secondary">No holes to review.</Typography>
      </Box>
    );
  }

  const current = holes[Math.min(cursor, holes.length - 1)];
  const rawCourse = current.courses;
  const course = Array.isArray(rawCourse) ? rawCourse[0] : rawCourse;

  const advance = () => {
    setPreviewFlip(false);
    setCursor((c) => Math.min(c + 1, holes.length));
  };

  const onConfirm = () => {
    confirmMutation.mutate(current.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['admin-review-queue'] });
        queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
        queryClient.invalidateQueries({ queryKey: ['hole-layout'] });
        advance();
      }
    });
  };

  const onFlip = () => {
    flipMutation.mutate(current.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['admin-review-queue'] });
        queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
        queryClient.invalidateQueries({ queryKey: ['hole-layout'] });
        advance();
      }
    });
  };

  const busy = confirmMutation.isPending || flipMutation.isPending;

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <ToggleButtonGroup
        value={filter}
        exclusive
        size="small"
        onChange={(_, v: Filter | null) => {
          if (v) {
            setFilter(v);
            setCursor(0);
          }
        }}
      >
        <ToggleButton value="all">All</ToggleButton>
        <ToggleButton value="assumed">Assumed</ToggleButton>
        <ToggleButton value="reversed">Reversed</ToggleButton>
      </ToggleButtonGroup>

      <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
            <Box>
              <Typography variant="subtitle1">{course?.name ?? 'Course'}</Typography>
              <Typography variant="caption" color="text.secondary">
                Hole {current.hole_number} · Par {current.par ?? '?'}
              </Typography>
            </Box>
            <Chip size="small" label={current.orientation_confidence} color="warning" />
          </Stack>
          <Box
            sx={{
              height: 360,
              transform: previewFlip ? 'rotate(180deg)' : 'none',
              transition: 'transform 200ms ease'
            }}
          >
            <HoleLayoutCard courseId={current.course_id} holeNumber={current.hole_number} />
          </Box>
          <Typography variant="caption" color="text.secondary" mt={1} display="block">
            {cursor + 1} of {holes.length} · {holes.length - cursor - 1} remaining
          </Typography>
        </CardContent>
      </Card>

      <Stack direction="row" spacing={1}>
        <Button
          variant="contained"
          color="success"
          onClick={onConfirm}
          disabled={busy}
          sx={{ flex: 1, minHeight: 56, fontWeight: 700 }}
        >
          Looks right
        </Button>
        <Button
          variant="contained"
          color="warning"
          onClick={onFlip}
          disabled={busy}
          sx={{ flex: 1, minHeight: 56, fontWeight: 700 }}
        >
          Flip it
        </Button>
      </Stack>
      <Stack direction="row" spacing={1}>
        <Button variant="outlined" onClick={() => setPreviewFlip((p) => !p)} sx={{ flex: 1 }}>
          {previewFlip ? 'Unpreview flip' : 'Preview flip'}
        </Button>
        <Button variant="outlined" onClick={advance} sx={{ flex: 1 }}>
          Skip
        </Button>
      </Stack>
    </Stack>
  );
}
