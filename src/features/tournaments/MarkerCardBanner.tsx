// "Somebody else kept this card — is it right?"
//
// Real golf has the player sign the marker's scorecard before it counts. This
// is that step. The round is already on TM's leaderboard (scores pushed live
// during play), so confirming isn't what makes it official — it's the athlete's
// acknowledgement that the card matches what they actually shot.
//
// Confirming freezes the card: the scorer's write policy in migration 034 is
// conditioned on `athlete_confirmed_at is null`, so afterwards they can read it
// but not change it. Disputing deliberately leaves it unconfirmed, which is
// exactly what keeps them able to fix it.

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import { roundRepo } from '@/services/roundRepo';
import { useAuthStore } from '@/stores/authStore';
import { toAppError } from '@/services/errors';
import type { Round } from '@/models';

export function MarkerCardBanner({ round }: { round: Round }) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  const [disputeOpen, setDisputeOpen] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
    queryClient.invalidateQueries({ queryKey: ['round-detail', round.id] });
  };

  const confirm = useMutation({
    mutationFn: () => roundRepo.confirmMarkerCard(round.id),
    onSuccess: invalidate,
    onError: (e) => setError(toAppError(e).message)
  });

  const dispute = useMutation({
    mutationFn: (text: string) => roundRepo.disputeMarkerCard(round.id, text),
    onSuccess: () => {
      setDisputeOpen(false);
      setNote('');
      invalidate();
    },
    onError: (e) => setError(toAppError(e).message)
  });

  // Only the athlete this card was handed to sees this, and only while the card
  // is still a marker card they own.
  if (round.scoring_mode !== 'MARKER' || round.user_id !== userId) return null;

  const confirmed = !!round.athlete_confirmed_at;
  const disputed = !!round.athlete_dispute_note;

  if (confirmed) {
    return (
      <Box sx={{ px: 2, mt: 1 }}>
        <Stack direction="row" alignItems="center" gap={0.75}>
          <CheckCircleRoundedIcon sx={{ fontSize: 16, color: 'success.main' }} />
          <Typography variant="caption" color="text.secondary">
            Kept by a scorekeeper · you confirmed this card
          </Typography>
        </Stack>
      </Box>
    );
  }

  return (
    <Box sx={{ px: 2, mt: 1 }}>
      <Card
        elevation={0}
        sx={{
          bgcolor: disputed ? 'rgba(239,68,68,0.10)' : 'rgba(59,130,246,0.10)',
          border: 1,
          borderColor: disputed ? 'rgba(239,68,68,0.5)' : 'rgba(59,130,246,0.4)',
          borderRadius: '5px'
        }}
      >
        <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
          <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>
            {disputed ? 'You flagged this card' : 'Recorded by a scorekeeper'}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {disputed
              ? 'The scorekeeper can still correct it. Confirm once it looks right.'
              : 'Someone else kept this scorecard for you. Check it over and confirm it matches what you shot.'}
          </Typography>

          {disputed && (
            <Typography
              variant="caption"
              sx={{ mt: 0.75, display: 'block', fontStyle: 'italic' }}
            >
              “{round.athlete_dispute_note}”
            </Typography>
          )}

          {error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {error}
            </Alert>
          )}

          <Stack direction="row" spacing={1} sx={{ mt: 1.5 }}>
            <Button
              size="small"
              variant="contained"
              startIcon={<CheckCircleRoundedIcon />}
              disabled={confirm.isPending}
              onClick={() => confirm.mutate()}
            >
              {confirm.isPending ? 'Confirming…' : 'Looks right'}
            </Button>
            {!disputed && (
              <Button
                size="small"
                variant="outlined"
                startIcon={<EditNoteRoundedIcon />}
                onClick={() => setDisputeOpen(true)}
              >
                Something&apos;s wrong
              </Button>
            )}
          </Stack>
        </CardContent>
      </Card>

      <Dialog open={disputeOpen} onClose={() => setDisputeOpen(false)} fullWidth maxWidth="xs">
        <DialogTitle>What&apos;s wrong with this card?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
            This goes back to the scorekeeper, who can still correct the round.
          </Typography>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={3}
            placeholder="e.g. hole 7 should be a 5, not a 4"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDisputeOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={!note.trim() || dispute.isPending}
            onClick={() => dispute.mutate(note.trim())}
          >
            {dispute.isPending ? 'Sending…' : 'Flag it'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
