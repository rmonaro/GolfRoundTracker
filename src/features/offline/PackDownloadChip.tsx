// "Saving maps" indicator for the round screen.
//
// The course's satellite imagery downloads automatically when a round starts,
// and it can be tens of megabytes. Without this the golfer has no idea their
// phone is pulling that much data, and no idea whether the course will actually
// be usable once signal drops — so the download stays silent right up until it
// matters. Appears only while a download is in flight.

import { Box, CircularProgress, Typography } from '@mui/material';
import { usePackDownload } from './usePackDownload';

export function PackDownloadChip({ courseId }: { courseId?: string | null }) {
  const download = usePackDownload(courseId);
  if (!download) return null;

  const pct = Math.round(download.fraction * 100);
  // A server that sends no content-length leaves fraction pinned at 0. Show a
  // spinner rather than a bar stuck at "0%", which reads as broken.
  const determinate = download.fraction > 0;

  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 0.75,
        py: 0.25,
        borderRadius: '5px',
        border: '1px solid',
        borderColor: 'info.dark',
        bgcolor: 'rgba(2,136,209,0.12)',
        flexShrink: 0
      }}
      // The visual is a progress ring; screen readers get the meaning.
      role="status"
      aria-label={
        determinate ? `Saving course maps, ${pct} percent` : 'Saving course maps'
      }
    >
      <CircularProgress
        size={12}
        thickness={6}
        variant={determinate ? 'determinate' : 'indeterminate'}
        value={determinate ? pct : undefined}
        sx={{ color: 'info.light' }}
      />
      <Typography
        variant="caption"
        sx={{ color: 'info.light', fontWeight: 700, fontSize: '0.65rem', whiteSpace: 'nowrap' }}
      >
        {determinate ? `MAPS ${pct}%` : 'MAPS'}
      </Typography>
    </Box>
  );
}
