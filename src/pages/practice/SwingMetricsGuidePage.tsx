import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';

interface Metric {
  name: string;
  what: string;
  read?: string;
}

interface Section {
  title: string;
  blurb: string;
  metrics: Metric[];
}

const SECTIONS: Section[] = [
  {
    title: 'Timing',
    blurb: 'Measured from when each phase of your swing happens. This is the most reliable group.',
    metrics: [
      {
        name: 'Backswing time',
        what: 'How long your takeaway to the top of the swing takes, in milliseconds.',
        read: 'Full swings are usually ~700–900 ms.'
      },
      {
        name: 'Downswing time',
        what: 'From the top of the swing down to impact, in milliseconds.',
        read: 'Much quicker — usually ~200–300 ms.'
      },
      {
        name: 'Tempo ratio',
        what: 'Backswing time divided by downswing time, shown as X.X : 1.',
        read: '≈ 3 : 1 is the classic target. Under ~2.2 = rushed backswing; over ~4 = loose/slow.'
      }
    ]
  },
  {
    title: 'Motion quality',
    blurb: 'Relative 0–100 scores from how smoothly and steadily you moved. Higher is generally better.',
    metrics: [
      {
        name: 'Transition',
        what: 'How smoothly you change direction at the top of the swing.',
        read: 'Low (under 40) means you snatch or yank the transition.'
      },
      {
        name: 'Estimated hand speed',
        what: 'How fast your wrist is rotating near impact, on a relative effort scale.',
        read: 'An effort score only — NOT mph and NOT clubhead speed.'
      },
      {
        name: 'Wrist rotation',
        what: 'How smooth and repeatable your forearm roll (release) is through the downswing.',
        read: 'Higher = a smoother, more consistent release.'
      },
      {
        name: 'Finish stability',
        what: 'How quickly and steadily your wrist settles in the moment after impact.',
        read: 'High (over 80) = a balanced, held finish. Low = falling off balance.'
      },
      {
        name: 'Release timing',
        what: 'How late in the downswing your wrist reaches peak speed.',
        read: 'Higher = speed held closer to impact (a lag-like pattern).'
      },
      {
        name: 'Through impact',
        what: 'Whether you keep accelerating into the ball or quit on it.',
        read: 'Low = decelerating through impact, a common power leak.'
      },
      {
        name: 'Swing direction',
        what: 'How consistent your rotation direction stays from backswing to downswing.',
        read: 'Low = an over-the-top-style direction shift — a tendency, NOT a measured club path.'
      }
    ]
  },
  {
    title: 'Swing type & shape',
    blurb: 'Estimated from how big and how long the motion was.',
    metrics: [
      {
        name: 'Swing type',
        what: 'Auto-labels each swing as full, pitch, chip, or putt from its speed and size.',
        read: 'Powers club averages even when the same club hits different shots.'
      },
      {
        name: 'Backswing length',
        what: 'How far your wrist rotated going back, shown as Short / Normal / Long.',
        read: 'A relative amount of rotation, not degrees of body turn.'
      },
      {
        name: 'Rehearsal detection',
        what: 'A practice/air swing with no contact is detected and tagged “Rehearsal”.',
        read: 'Rehearsals are kept out of your stats and club averages.'
      }
    ]
  },
  {
    title: 'Consistency',
    blurb: 'These compare a swing to the rest of your session, so they appear once you end the session.',
    metrics: [
      {
        name: 'Swing consistency',
        what: "How close this swing's tempo was to your session average.",
        read: 'High = it matched your norm; low = an outlier.'
      },
      {
        name: 'Pattern consistency',
        what: 'How closely you repeated the same overall motion shape (your “plane tendency”).',
        read: 'A repeatability score — NOT a measured swing-plane angle in degrees.'
      },
      {
        name: 'Setup consistency',
        what: 'How repeatable your address/setup orientation was across swings.',
        read: 'High = you set up the same way each time.'
      }
    ]
  },
  {
    title: 'Recorded with each swing',
    blurb: 'Context saved alongside the motion metrics.',
    metrics: [
      {
        name: 'Club',
        what: 'Which club was selected on the watch for that swing.',
        read: 'Powers the “By club” breakdown and per-club averages.'
      },
      {
        name: 'Shot result (optional)',
        what: 'Anything you tag yourself: straight, left, right, thin, fat, toe, heel, and so on.',
        read: 'This is not sensed — only what you enter.'
      },
      {
        name: 'Time & order',
        what: 'When the swing happened and its number within the session.'
      }
    ]
  },
  {
    title: 'Heart rate (Apple Watch)',
    blurb: 'A real sensor reading (not an estimate) when HealthKit is enabled. Captured by a workout session during practice.',
    metrics: [
      {
        name: 'Heart rate per swing',
        what: 'Your live heart rate at the moment of each swing, in bpm.',
        read: 'Watch it climb on harder swings or as a session goes on.'
      },
      {
        name: 'Average / max heart rate',
        what: 'Your typical and peak heart rate across the session.'
      },
      {
        name: 'HRV & calories',
        what: 'Heart-rate variability (a tension/recovery signal) and active calories.',
        read: 'HRV is often unavailable during activity, so it may show “—”.'
      }
    ]
  },
  {
    title: 'Session totals',
    blurb: 'Computed across all swings when you end a session.',
    metrics: [
      {
        name: 'Averages',
        what: 'Your average tempo, plus tempo and pattern consistency across the whole session.'
      },
      {
        name: 'Fatigue trend',
        what: 'Compares the last third of your session to the first third.',
        read: 'Flags “possible/likely fatigue” when speed, balance, and rhythm all drop together.'
      },
      {
        name: 'Pace (rest between swings)',
        what: 'Your average rest between swings, and whether you were rushing.',
        read: 'Short rests can hurt focus and repeatability.'
      }
    ]
  }
];

function MetricRow({ metric }: { metric: Metric }) {
  return (
    <Box>
      <Typography variant="subtitle2" fontWeight={700}>
        {metric.name}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {metric.what}
      </Typography>
      {metric.read && (
        <Typography variant="caption" color="primary" sx={{ display: 'block', mt: 0.25 }}>
          {metric.read}
        </Typography>
      )}
    </Box>
  );
}

export function SwingMetricsGuidePage() {
  const navigate = useNavigate();

  return (
    <Box sx={{ p: 2, maxWidth: 560, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={800}>
        What your swing data means
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Your Apple Watch samples wrist motion about 100 times a second, detects
        each phase of your swing, and turns it into the numbers below. Use them
        to track your rhythm, smoothness, and repeatability over time.
      </Typography>

      <MotionDisclaimer />

      <Stack spacing={2} sx={{ mt: 2 }}>
        {SECTIONS.map((section) => (
          <Paper key={section.title} variant="outlined" sx={{ p: 2, borderRadius: 0 }}>
            <Typography variant="h6" fontWeight={800}>
              {section.title}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {section.blurb}
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 1.5 }} divider={<Divider flexItem />}>
              {section.metrics.map((m) => (
                <MetricRow key={m.name} metric={m} />
              ))}
            </Stack>
          </Paper>
        ))}

        {/* The honest boundary of what a wrist sensor can know. */}
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            borderRadius: 0,
            borderColor: 'warning.main',
            bgcolor: (theme) => alpha(theme.palette.warning.main, 0.08)
          }}
        >
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h6" fontWeight={800}>
              What it can’t measure
            </Typography>
            <Chip size="small" color="warning" label="Important" />
          </Stack>
          <Typography variant="body2" color="text.secondary">
            A wrist sensor sees <strong>how you moved</strong> — rhythm,
            smoothness, repeatability, and balance. It does <strong>not</strong>{' '}
            measure clubface angle, club path, swing-plane degrees, launch
            angle, ball speed, spin, or carry distance. These are estimates and
            relative scores, not launch-monitor data — best for questions like
            “is my tempo consistent today?” or “am I getting tired?”, not for
            ball-flight numbers.
          </Typography>
        </Paper>
      </Stack>

      <Button variant="contained" fullWidth sx={{ mt: 3 }} onClick={() => navigate(-1)}>
        Got it
      </Button>
    </Box>
  );
}
