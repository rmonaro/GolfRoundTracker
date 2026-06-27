import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';

/**
 * A single step of the round walkthrough. `selector` targets the element to
 * highlight (a `data-tour="…"` attribute on the control). When null, the step
 * is shown centered with no spotlight (used for the intro/outro). Steps whose
 * target isn't currently in the DOM are skipped automatically, so conditional
 * controls (e.g. the Track FAB when GPS is off) don't strand the tour.
 */
export interface TourStep {
  selector: string | null;
  title: string;
  body: string;
}

interface RoundTourProps {
  open: boolean;
  steps: TourStep[];
  /** Called when the user finishes, skips, or the tour runs out of targets. */
  onClose: () => void;
}

interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

// Breathing room around the highlighted element, in px.
const SPOTLIGHT_PAD = 8;
// Rough tooltip height budget used to decide above/below placement.
const TOOLTIP_BUDGET = 180;
const Z = 2000;

export function RoundTour({ open, steps, onClose }: RoundTourProps) {
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  // Bumped on resize/scroll to force a rect recompute.
  const [tick, setTick] = useState(0);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Restart from the first step whenever the tour (re)opens.
  useEffect(() => {
    if (open) {
      setIndex(0);
      setTick((t) => t + 1);
    }
  }, [open]);

  // Resolve the current step's target rect, skipping forward over any steps
  // whose selector matches nothing on screen. If we run past the end, close.
  useLayoutEffect(() => {
    if (!open) return;
    let i = index;
    while (i < steps.length && steps[i].selector) {
      if (document.querySelector(steps[i].selector as string)) break;
      i++;
    }
    if (i >= steps.length) {
      onCloseRef.current();
      return;
    }
    if (i !== index) {
      setIndex(i);
      return;
    }
    const sel = steps[i].selector;
    if (!sel) {
      setRect(null);
      return;
    }
    const el = document.querySelector(sel);
    if (!el) {
      setRect(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [open, index, steps, tick]);

  // Keep the spotlight glued to its target as the layout shifts.
  useEffect(() => {
    if (!open) return;
    const recompute = () => setTick((t) => t + 1);
    window.addEventListener('resize', recompute);
    window.addEventListener('scroll', recompute, true);
    return () => {
      window.removeEventListener('resize', recompute);
      window.removeEventListener('scroll', recompute, true);
    };
  }, [open]);

  const goNext = useCallback(() => {
    setIndex((i) => {
      if (i >= steps.length - 1) {
        onCloseRef.current();
        return i;
      }
      return i + 1;
    });
  }, [steps.length]);

  const goBack = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  if (!open) return null;
  const step = steps[index];
  if (!step) return null;
  const isLast = index === steps.length - 1;

  const spot: Rect | null = rect
    ? {
        top: Math.max(0, rect.top - SPOTLIGHT_PAD),
        left: Math.max(0, rect.left - SPOTLIGHT_PAD),
        width: rect.width + SPOTLIGHT_PAD * 2,
        height: rect.height + SPOTLIGHT_PAD * 2
      }
    : null;

  // Place the tooltip below the target when there's room, else above; if the
  // target is too tall for either (e.g. the full-screen map) — or there's no
  // spotlight at all — center it.
  const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
  let tooltipPos: React.CSSProperties;
  if (spot && spot.top + spot.height + 12 + TOOLTIP_BUDGET < vh) {
    tooltipPos = {
      top: spot.top + spot.height + 12,
      left: '50%',
      transform: 'translateX(-50%)'
    };
  } else if (spot && spot.top - 12 - TOOLTIP_BUDGET > 0) {
    tooltipPos = {
      top: Math.max(12, spot.top - 12),
      left: '50%',
      transform: 'translate(-50%, -100%)'
    };
  } else {
    tooltipPos = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  }

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: Z, pointerEvents: 'none' }}>
      {/* Click-blocking dim. When a target is highlighted the dim is drawn by
          the spotlight's big box-shadow, so this layer stays transparent and
          only swallows taps; with no target it dims the whole screen itself. */}
      <Box
        onClick={(e) => e.stopPropagation()}
        sx={{
          position: 'absolute',
          inset: 0,
          pointerEvents: 'auto',
          bgcolor: spot ? 'transparent' : 'rgba(0,0,0,0.72)'
        }}
      />

      {spot && (
        <Box
          sx={{
            position: 'absolute',
            top: spot.top,
            left: spot.left,
            width: spot.width,
            height: spot.height,
            borderRadius: '10px',
            border: '2px solid #fbbf24',
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.72)',
            pointerEvents: 'none',
            transition: 'all 0.2s ease'
          }}
        />
      )}

      <Box
        sx={{
          position: 'absolute',
          width: 'min(320px, calc(100vw - 32px))',
          pointerEvents: 'auto',
          bgcolor: 'rgba(11,20,16,0.97)',
          color: 'common.white',
          border: '1.5px solid #fbbf24',
          borderRadius: '12px',
          boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
          p: 2,
          ...tooltipPos
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: '#fbbf24',
            fontWeight: 700,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            fontSize: '0.62rem'
          }}
        >
          {`Step ${index + 1} of ${steps.length}`}
        </Typography>
        <Typography sx={{ fontWeight: 800, fontSize: '1rem', mt: 0.25 }}>
          {step.title}
        </Typography>
        <Typography sx={{ fontSize: '0.85rem', color: 'rgba(255,255,255,0.82)', mt: 0.75 }}>
          {step.body}
        </Typography>

        <Stack direction="row" alignItems="center" spacing={1} sx={{ mt: 2 }}>
          <Button
            size="small"
            onClick={() => onCloseRef.current()}
            sx={{ color: 'rgba(255,255,255,0.6)', textTransform: 'none', minWidth: 0 }}
          >
            Skip
          </Button>
          <Box sx={{ flex: 1 }} />
          {index > 0 && (
            <Button
              size="small"
              onClick={goBack}
              sx={{ color: 'common.white', textTransform: 'none' }}
            >
              Back
            </Button>
          )}
          <Button
            size="small"
            variant="contained"
            onClick={goNext}
            sx={{
              bgcolor: '#fbbf24',
              color: '#0b1410',
              fontWeight: 800,
              textTransform: 'none',
              borderRadius: 999,
              px: 2,
              '&:hover': { bgcolor: '#f59e0b' }
            }}
          >
            {isLast ? 'Done' : 'Next'}
          </Button>
        </Stack>
      </Box>
    </Box>
  );
}
