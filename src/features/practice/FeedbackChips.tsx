import { useState } from 'react';
import {
  Box,
  Chip,
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography
} from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { SwingFeedback } from '@/types/swing';
import { feedbackExplanation } from '@/services/swingFeedbackEngine';

const levelColor = (level: SwingFeedback['level']) =>
  level === 'positive' ? 'success' : level === 'attention' ? 'warning' : 'default';

/**
 * Renders swing-feedback messages as chips. Tapping a chip opens a dialog with a
 * plain-language explanation of what it means and what to do about it.
 */
export function FeedbackChips({ items }: { items: SwingFeedback[] }) {
  const [active, setActive] = useState<SwingFeedback | null>(null);

  if (items.length === 0) return null;

  return (
    <>
      <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
        {items.map((f) => (
          <Chip
            key={f.code}
            size="small"
            color={levelColor(f.level)}
            label={f.message}
            onClick={() => setActive(f)}
          />
        ))}
      </Stack>

      <Dialog open={active != null} onClose={() => setActive(null)} maxWidth="xs" fullWidth>
        {active && (
          <>
            <DialogTitle sx={{ pr: 6 }}>
              {active.message}
              <IconButton
                aria-label="Close"
                onClick={() => setActive(null)}
                sx={{ position: 'absolute', top: 8, right: 8 }}
              >
                <CloseRoundedIcon />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              <Typography variant="body2" color="text.secondary">
                {feedbackExplanation(active.code) || 'No additional detail for this one yet.'}
              </Typography>
              {active.disclaimer && (
                <Box sx={{ mt: 2 }}>
                  <Typography variant="caption" color="text.disabled">
                    {active.disclaimer}
                  </Typography>
                </Box>
              )}
            </DialogContent>
          </>
        )}
      </Dialog>
    </>
  );
}
