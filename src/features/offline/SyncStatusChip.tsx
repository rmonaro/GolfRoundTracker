// "Is my round safe?" — answered without the golfer having to ask.
//
// Shows only when there's something to say: unsynced work, no signal, or a sync
// that needs the user to sign in. A permanent "synced ✓" badge is noise; silence
// means fine.

import { useState } from 'react';
import { Box, Chip, CircularProgress, Tooltip } from '@mui/material';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import CloudSyncRoundedIcon from '@mui/icons-material/CloudSyncRounded';
import ErrorOutlineRoundedIcon from '@mui/icons-material/ErrorOutlineRounded';
import { useConnectivity } from './useConnectivity';
import { useRoundStore } from '@/stores/roundStore';
import { useOutboxStore } from '@/stores/outboxStore';
import { pendingCount, syncAll } from '@/services/roundSync';

export function SyncStatusChip({ compact = false }: { compact?: boolean }) {
  const { isOnline } = useConnectivity();
  const active = useRoundStore((s) => s.active);
  const outbox = useOutboxStore((s) => s.pending);
  const [syncing, setSyncing] = useState(false);
  const [needsAuth, setNeedsAuth] = useState(false);

  const activePending = pendingCount(active);
  const outboxPending = outbox.length;
  const total = activePending + outboxPending;

  // Everything is up to date and we have signal — say nothing.
  if (total === 0 && isOnline) return null;

  const onSync = async () => {
    if (syncing) return;
    setSyncing(true);
    try {
      const result = await syncAll();
      setNeedsAuth(!!result.needsAuth);
    } finally {
      setSyncing(false);
    }
  };

  let label: string;
  let color: 'default' | 'warning' | 'error' = 'default';
  let icon = <CloudOffRoundedIcon sx={{ fontSize: 16 }} />;
  let tip: string;

  if (needsAuth) {
    label = 'Sign in to sync';
    color = 'error';
    icon = <ErrorOutlineRoundedIcon sx={{ fontSize: 16 }} />;
    tip = 'Your session expired. Your round is saved on this device — sign in again and it will upload.';
  } else if (total > 0) {
    label = compact ? `${total}` : `${total} to sync`;
    color = 'warning';
    icon = <CloudSyncRoundedIcon sx={{ fontSize: 16 }} />;
    tip = isOnline
      ? 'Uploading your round.'
      : 'Saved on this device. It will upload automatically when you have signal.';
  } else {
    label = compact ? '' : 'Offline';
    tip = 'No signal. Your round is being saved on this device.';
  }

  return (
    <Tooltip title={tip}>
      <Box component="span">
        <Chip
          size="small"
          color={color}
          variant="outlined"
          icon={syncing ? <CircularProgress size={12} sx={{ ml: 1 }} /> : icon}
          label={label}
          // Manual retry is the escape hatch when the automatic triggers
          // haven't fired yet and the golfer wants reassurance now.
          onClick={isOnline ? () => void onSync() : undefined}
          sx={{ fontWeight: 700, cursor: isOnline ? 'pointer' : 'default' }}
        />
      </Box>
    </Tooltip>
  );
}
