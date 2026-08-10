// Download / remove a course's satellite imagery for offline play.
//
// Imagery is opt-in, unlike the ~145 KB of geometry that's cached silently on
// round start: a pack is ~4 MB, so the golfer decides — and sees the size
// before committing, since this is often done on cellular in a car park.

import { useEffect, useState } from 'react';
import { Box, Button, LinearProgress, Stack, Typography } from '@mui/material';
import CloudDownloadRoundedIcon from '@mui/icons-material/CloudDownloadRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import {
  deletePack,
  downloadPack,
  getPackMeta,
  getRemotePackInfo,
  isPackStale,
  type CoursePackMeta,
  type RemotePackInfo
} from '@/services/coursePackRepo';
import { useConnectivity } from './useConnectivity';

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CoursePackButton({
  courseId,
  courseName,
  onChanged
}: {
  courseId: string;
  courseName?: string | null;
  /** Lets the map re-resolve its imagery tier as soon as a pack lands. */
  onChanged?: () => void;
}) {
  const { isOnline } = useConnectivity();
  const [local, setLocal] = useState<CoursePackMeta | null>(null);
  const [remote, setRemote] = useState<RemotePackInfo | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const meta = await getPackMeta(courseId);
      if (!cancelled) setLocal(meta);
      // Check the remote even when a pack is already saved — that's the only
      // way to notice the course has been re-tiled since.
      if (isOnline) {
        try {
          const info = await getRemotePackInfo(courseId);
          if (!cancelled) setRemote(info);
        } catch {
          /* availability is best-effort — absence just hides the button */
        }
      }
      if (!cancelled) setChecked(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [courseId, isOnline]);

  const onDownload = async () => {
    if (!remote) return;
    setError(null);
    setProgress(0);
    try {
      const meta = await downloadPack(courseId, courseName ?? null, remote, setProgress);
      setLocal(meta);
      onChanged?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setProgress(null);
    }
  };

  const onDelete = async () => {
    await deletePack(courseId);
    setLocal(null);
    onChanged?.();
    if (isOnline) setRemote(await getRemotePackInfo(courseId).catch(() => null));
  };

  // Nothing to offer: no pack on the device and none built for this course yet.
  // Silence is right — most courses won't have imagery until the tiler runs.
  if (!checked || (!local && !remote)) return null;

  if (progress != null) {
    return (
      <Stack spacing={0.5} sx={{ minWidth: 160 }}>
        <Typography variant="caption" color="text.secondary">
          Downloading maps… {Math.round(progress * 100)}%
        </Typography>
        <LinearProgress variant="determinate" value={progress * 100} />
      </Stack>
    );
  }

  if (local && isPackStale(local, remote)) {
    return (
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <Button
          size="small"
          variant="outlined"
          color="warning"
          startIcon={<CloudDownloadRoundedIcon sx={{ fontSize: 16 }} />}
          onClick={() => void onDownload()}
          disabled={!isOnline}
          sx={{ textTransform: 'none' }}
        >
          Update maps{remote?.sizeBytes ? ` (${formatSize(remote.sizeBytes)})` : ''}
        </Button>
        <Typography variant="caption" color="text.secondary">
          newer imagery available
        </Typography>
      </Stack>
    );
  }

  if (local) {
    return (
      <Stack direction="row" alignItems="center" spacing={0.5}>
        <CheckCircleRoundedIcon sx={{ fontSize: 16, color: 'success.main' }} />
        <Typography variant="caption" color="text.secondary">
          Maps saved ({formatSize(local.sizeBytes)})
        </Typography>
        <Button
          size="small"
          color="error"
          aria-label="Remove downloaded maps"
          onClick={() => void onDelete()}
          sx={{ minWidth: 0, px: 0.5 }}
        >
          <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
        </Button>
      </Stack>
    );
  }

  return (
    <Box>
      <Button
        size="small"
        variant="outlined"
        startIcon={<CloudDownloadRoundedIcon sx={{ fontSize: 16 }} />}
        onClick={() => void onDownload()}
        disabled={!isOnline}
        sx={{ textTransform: 'none' }}
      >
        Save maps offline{remote?.sizeBytes ? ` (${formatSize(remote.sizeBytes)})` : ''}
      </Button>
      {error && (
        <Typography variant="caption" color="error" sx={{ display: 'block', mt: 0.5 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
