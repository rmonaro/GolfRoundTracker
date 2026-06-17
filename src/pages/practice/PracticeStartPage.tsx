import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import type { SxProps, Theme } from "@mui/material";
import WatchRoundedIcon from "@mui/icons-material/WatchRounded";
import ChevronRightRoundedIcon from "@mui/icons-material/ChevronRightRounded";
import ArrowBackRoundedIcon from "@mui/icons-material/ArrowBackRounded";
import { Capacitor } from "@capacitor/core";
import { useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import { useAuthStore } from "@/stores/authStore";
import { useSwingSessionStore } from "@/stores/swingSessionStore";
import { practiceController } from "@/features/practice/practiceController";
import { swingRepo } from "@/services/swingRepo";
import { watchBridge } from "@/services/watchBridge";
import { MotionDisclaimer } from "@/components/practice/MotionDisclaimer";
import { watchName } from "@/utils/platform";
import type { SwingSession } from "@/types/swing";
import { practicePageSx } from "./practicePageSx";

function WeekStat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ textAlign: "center", px: 1 }}>
      <Typography
        sx={{ fontWeight: 800, fontSize: "1.4rem", lineHeight: 1.15 }}
      >
        {value}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: "uppercase", letterSpacing: 0.5 }}
      >
        {label}
      </Typography>
    </Box>
  );
}

// Bordered, inset (not full-width) drawer item with 15px/16px padding.
const practiceItemSx: SxProps<Theme> = {
  alignItems: "center",
  gap: 1.5,
  border: "1px solid",
  borderColor: "divider",
  borderRadius: "5px",
  p: "15px 16px",
  mb: 1.5,
};

// 42x42 container for each item's icon.
const practiceIconBoxSx: SxProps<Theme> = {
  width: 42,
  height: 42,
  flexShrink: 0,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  borderRadius: 1.5,
  bgcolor: "action.hover",
};

export function PracticeStartPage() {
  const navigate = useNavigate();
  const activeSession = useSwingSessionStore((s) => s.session);
  const [starting, setStarting] = useState(false);
  const [launchInfo, setLaunchInfo] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [watchConnected, setWatchConnected] = useState(false);
  const isIos = Capacitor.getPlatform() === "ios";

  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [sessions, setSessions] = useState<SwingSession[]>([]);
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    swingRepo
      .listSessions(userId)
      .then((s) => {
        if (!cancelled) setSessions(s);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setSessionsLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // This-week summary: sessions count, per-day swing bars (Mon-start), streak,
  // and the three footer stats.
  const week = useMemo(() => {
    const today = dayjs();
    const monday = today.subtract((today.day() + 6) % 7, "day").startOf("day");
    const todayKey = today.format("YYYY-MM-DD");
    const labels = ["M", "T", "W", "T", "F", "S", "S"];
    const days = labels.map((label, i) => {
      const key = monday.add(i, "day").format("YYYY-MM-DD");
      const value = sessions
        .filter((s) => dayjs(s.startedAt).format("YYYY-MM-DD") === key)
        .reduce((sum, s) => sum + (s.swingCount ?? 0), 0);
      return { label, value, isToday: key === todayKey };
    });
    const max = Math.max(1, ...days.map((d) => d.value));
    const inWeek = sessions.filter((s) => !dayjs(s.startedAt).isBefore(monday));
    const avg = (xs: number[]) =>
      xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    // KPIs are all-time totals (not just this week).
    const tempos = sessions
      .map((s) => s.avgTempoRatio)
      .filter((v): v is number => v != null);
    const cons = sessions
      .map((s) => s.tempoConsistencyScore)
      .filter((v): v is number => v != null);

    return {
      thisWeekCount: inWeek.length,
      totalSessions: sessions.length,
      days,
      max,
      totalSwings: sessions.reduce((sum, s) => sum + (s.swingCount ?? 0), 0),
      avgTempo: avg(tempos),
      consistency: avg(cons),
    };
  }, [sessions]);

  // "Connected" = a watch is paired (not live reachability, and not gated on
  // the watch app being installed — WCSession.isWatchAppInstalled is often
  // false for paired watches / dev builds). isPaired is only valid once the
  // session finishes activating (async), so a fresh launch can briefly report
  // false — retry a few times, and re-check when the page regains focus.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;

    const check = async () => {
      try {
        const res = await watchBridge.activate();
        const connected = "isPaired" in res && Boolean(res.isPaired);
        if (cancelled) return;
        setWatchConnected(connected);
        if (!connected && attempts < 6) {
          attempts += 1;
          timer = setTimeout(() => void check(), 500);
        }
      } catch {
        /* best-effort */
      }
    };

    void check();
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        attempts = 0;
        void check();
      }
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  const onStart = async () => {
    setStarting(true);
    setLaunchInfo(null);
    try {
      // Launch the watch straight into practice mode (HealthKit startWatchApp).
      // We surface the result so a failed launch is diagnosable in-app rather
      // than silently doing nothing.
      const result = await watchBridge.launchWatch(true);
      if (!Capacitor.isNativePlatform()) {
        setLaunchInfo("Watch launch only works on a real iPhone build.");
      } else if (result.launched) {
        setLaunchInfo(`Opening practice on your ${watchName()}…`);
      } else {
        setLaunchInfo(
          `Couldn't open the watch app automatically (${result.reason ?? "unknown"}). ` +
            "Open Practice on the watch manually — your swings still record.",
        );
      }
      console.log("[practice] launchWatchPractice result:", result);

      // Start the phone session, but stay on this screen so the launch result
      // above stays visible. Tap "Resume live session" to go to the feed.
      // Club is chosen on the watch / per-swing now, so start without one.
      await practiceController.start(null);
    } finally {
      setStarting(false);
    }
  };

  return (
    <Box sx={practicePageSx()}>
      <IconButton
        aria-label="Back"
        onClick={() => navigate("/")}
        sx={{ ml: -1, mb: 1 }}
      >
        <ArrowBackRoundedIcon />
      </IconButton>
      <Typography
        variant="h5"
        sx={{ fontWeight: 900, fontSize: "35px", lineHeight: 1.1 }}
      >
        Practice Session
      </Typography>

      <Card
        elevation={0}
        sx={{ bgcolor: "background.paper", borderRadius: "5px", mt: 2 }}
      >
        <CardContent
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1.5,
            "&:last-child": { pb: 2 },
          }}
        >
          {isIos ? (
            <svg
              width="26"
              height="34"
              viewBox="0 0 20 26"
              fill="none"
              style={{ flexShrink: 0 }}
            >
              <rect
                x="3"
                y="5"
                width="14"
                height="16"
                rx="4"
                fill="none"
                stroke="#324279"
                strokeWidth="1.6"
              />
              <path
                d="M6 5 6.7 1.8A1.5 1.5 0 0 1 8.2 .6h3.6a1.5 1.5 0 0 1 1.5 1.2L14 5M6 21l.7 3.2A1.5 1.5 0 0 0 8.2 25.4h3.6a1.5 1.5 0 0 0 1.5-1.2L14 21"
                stroke="#324279"
                strokeWidth="1.6"
              />
              <circle cx="10" cy="13" r="3" fill="#2f9e6e" />
            </svg>
          ) : (
            <WatchRoundedIcon
              sx={{
                fontSize: 36,
                color: watchConnected ? "primary.main" : "text.disabled",
              }}
            />
          )}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  flexShrink: 0,
                  bgcolor: watchConnected ? "success.main" : "text.disabled",
                }}
              />
              <Typography variant="body2" fontWeight={700} noWrap>
                {watchName({ title: true })}{" "}
                {watchConnected ? "Connected" : "not connected"}
              </Typography>
            </Stack>
            <Typography variant="caption" color="text.secondary">
              {watchConnected
                ? "Motion sensors ready"
                : "Pair your watch to track swings"}
            </Typography>
          </Box>
        </CardContent>
      </Card>

      <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
        Uses {watchName()} motion sensors to estimate your swing{" "}
        <strong>tempo</strong> and <strong>consistency</strong>.
      </Typography>

      <MotionDisclaimer />

      {launchInfo && (
        <Alert
          severity={launchInfo.startsWith("Opening") ? "success" : "info"}
          sx={{ mt: 2 }}
        >
          {launchInfo}
        </Alert>
      )}

      {sessionsLoaded && week.totalSessions === 0 ? (
        <Card variant="outlined" sx={{ borderRadius: "5px", mt: 3 }}>
          <CardContent sx={{ textAlign: "center", py: 4 }}>
            <Box
              sx={{
                width: 54,
                height: 54,
                mx: "auto",
                mb: 1.5,
                borderRadius: "5px",
                border: "1px solid",
                borderColor: "divider",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <svg width="26" height="26" viewBox="0 0 22 22" fill="none">
                <circle
                  cx="11"
                  cy="11"
                  r="7.5"
                  stroke="#ffd580"
                  strokeWidth="1.5"
                />
                <circle
                  cx="11"
                  cy="11"
                  r="3"
                  stroke="#ffd580"
                  strokeWidth="1.5"
                />
                <circle cx="11" cy="11" r="1" fill="#ffd580" />
              </svg>
            </Box>
            <Typography sx={{ fontWeight: 700, fontSize: "18px" }}>
              No practices yet
            </Typography>
            <Typography
              color="text.secondary"
              sx={{
                fontSize: "13px",
                lineHeight: 1.5,
                mt: 0.5,
                maxWidth: 300,
                mx: "auto",
              }}
            >
              Take your first swing to start tracking tempo, consistency, and
              your shots by club.
            </Typography>
          </CardContent>
        </Card>
      ) : (
        <Card
          elevation={0}
          sx={{ bgcolor: "background.paper", borderRadius: "5px", mt: 3 }}
        >
          <CardContent>
            <Stack direction="row" spacing={4} alignItems="flex-start">
              <Box>
                <Typography
                  sx={{
                    color: "#f88930",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    fontWeight: 800,
                    fontSize: "0.75rem",
                    lineHeight: 1.6,
                  }}
                >
                  This Week
                </Typography>
                <Typography
                  sx={{ fontSize: "3em", fontWeight: 800, lineHeight: 1.1 }}
                >
                  {week.thisWeekCount}
                </Typography>
              </Box>
              <Box>
                <Typography
                  sx={{
                    color: "text.secondary",
                    textTransform: "uppercase",
                    letterSpacing: 1,
                    fontWeight: 800,
                    fontSize: "0.75rem",
                    lineHeight: 1.6,
                  }}
                >
                  Total Sessions
                </Typography>
                <Typography
                  sx={{ fontSize: "3em", fontWeight: 800, lineHeight: 1.1 }}
                >
                  {week.totalSessions}
                </Typography>
              </Box>
            </Stack>

            <Box
              sx={{
                display: "flex",
                alignItems: "flex-end",
                justifyContent: "space-between",
                mt: 2,
              }}
            >
              {week.days.map((d, i) => (
                <Stack
                  key={i}
                  sx={{ alignItems: "center", flex: 1 }}
                  spacing={0.75}
                >
                  <Box
                    sx={{ height: 48, display: "flex", alignItems: "flex-end" }}
                  >
                    <Box
                      sx={{
                        width: 10,
                        height: `${Math.max(18, (d.value / week.max) * 100)}%`,
                        borderRadius: "6px",
                        bgcolor: d.isToday
                          ? "#f88930"
                          : (theme) =>
                              theme.palette.mode === "dark"
                                ? "#3b475e"
                                : "#cfd6e0",
                      }}
                    />
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {d.label}
                  </Typography>
                </Stack>
              ))}
            </Box>

            <Divider sx={{ my: 2 }} />

            <Stack
              direction="row"
              divider={<Divider orientation="vertical" flexItem />}
            >
              <Box sx={{ flex: 1 }}>
                <WeekStat
                  label="Avg Tempo"
                  value={
                    week.avgTempo != null
                      ? `${week.avgTempo.toFixed(1)}:1`
                      : "—"
                  }
                />
              </Box>
              <Box sx={{ flex: 1 }}>
                <WeekStat label="Swings" value={String(week.totalSwings)} />
              </Box>
              <Box sx={{ flex: 1 }}>
                <WeekStat
                  label="Consistency"
                  value={
                    week.consistency != null
                      ? `${Math.round(week.consistency)}%`
                      : "—"
                  }
                />
              </Box>
            </Stack>
          </CardContent>
        </Card>
      )}

      {activeSession ? (
        <Stack spacing={2} sx={{ mt: 3 }}>
          <Typography variant="body2">
            A practice session is already in progress.
          </Typography>
          <Button
            variant="contained"
            onClick={() => navigate("/practice/live")}
          >
            Resume live session
          </Button>
        </Stack>
      ) : (
        <Stack spacing={2} sx={{ mt: 2 }}>
          <Button
            variant="contained"
            size="large"
            disabled={starting}
            onClick={() => setDrawerOpen(true)}
          >
            Start Practice
          </Button>
        </Stack>
      )}

      <Button
        sx={{ mt: 2 }}
        variant="outlined"
        fullWidth
        onClick={() => navigate("/practice/history")}
      >
        View past practices
      </Button>

      <Button
        sx={{ mt: 1 }}
        fullWidth
        onClick={() => navigate("/practice/guide")}
      >
        What's measured & what it means
      </Button>

      <Drawer
        anchor="bottom"
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            pt: "24px",
            px: "24px",
            pb: "calc(env(safe-area-inset-bottom) + 8px)",
          },
        }}
      >
        <Typography fontWeight={800} sx={{ fontSize: "1.75em" }}>
          Choose a Practice
        </Typography>
        <List sx={{ pt: 1, px: 0 }}>
          <ListItemButton
            onClick={() => {
              setDrawerOpen(false);
              navigate("/range");
            }}
            sx={practiceItemSx}
          >
            <Box sx={practiceIconBoxSx}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <circle
                  cx="11"
                  cy="11"
                  r="8"
                  stroke="#f88930"
                  strokeWidth="1.6"
                />
                <circle
                  cx="11"
                  cy="11"
                  r="3.4"
                  stroke="#f88930"
                  strokeWidth="1.6"
                />
                <circle cx="11" cy="11" r="1.1" fill="#f88930" />
              </svg>
            </Box>
            <ListItemText
              primary="Range"
              secondary="Track shots by club on the GPS map."
              primaryTypographyProps={{ fontSize: "1.25rem", fontWeight: 700 }}
            />
            <ChevronRightRoundedIcon
              sx={{ color: "text.disabled", flexShrink: 0 }}
            />
          </ListItemButton>
          <Button
            size="small"
            onClick={() => {
              setDrawerOpen(false);
              navigate("/range/guide");
            }}
            sx={{ alignSelf: "flex-start", textTransform: "none", mt: -0.5, mb: 0.5, ml: 0.5 }}
          >
            How the range works
          </Button>

          <ListItemButton
            disabled={starting}
            onClick={async () => {
              setDrawerOpen(false);
              await onStart();
              navigate("/practice/live");
            }}
            sx={practiceItemSx}
          >
            <Box sx={practiceIconBoxSx}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path
                  d="M2 11h3.5L8 5l4.5 12L15 9h5"
                  stroke="#2fd27b"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </Box>
            <ListItemText
              primary="Swing/Net"
              secondary="Live tempo & consistency from your watch."
              primaryTypographyProps={{ fontSize: "1.25rem", fontWeight: 700 }}
            />
            <ChevronRightRoundedIcon
              sx={{ color: "text.disabled", flexShrink: 0 }}
            />
          </ListItemButton>

          <ListItemButton disabled sx={practiceItemSx}>
            <Box sx={practiceIconBoxSx}>
              <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
                <path
                  d="M8 3.2v9.5"
                  stroke="#8a93ab"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                />
                <path d="M8 3.2l5.5 1.7L8 6.6Z" fill="#8a93ab" />
                <ellipse
                  cx="11"
                  cy="16.6"
                  rx="7"
                  ry="2.6"
                  stroke="#8a93ab"
                  strokeWidth="1.5"
                />
              </svg>
            </Box>
            <ListItemText
              primary="Putting"
              secondary="Coming soon"
              primaryTypographyProps={{ fontSize: "1.25rem", fontWeight: 700 }}
            />
            <ChevronRightRoundedIcon
              sx={{ color: "text.disabled", flexShrink: 0 }}
            />
          </ListItemButton>
        </List>
      </Drawer>
    </Box>
  );
}
