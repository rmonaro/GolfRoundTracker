import { Box, Stack, Typography } from "@mui/material";
import { Outlet } from "react-router-dom";
import appIconUrl from "@/app/assets/AppIcon.png";

export function AuthLayout() {
  return (
    <Box
      sx={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.default",
        px: 3,
        py: 6,
        backgroundImage:
          "radial-gradient(ellipse at top, rgba(46,125,50,0.25), transparent 60%), radial-gradient(ellipse at bottom, rgba(76,175,80,0.18), transparent 70%)",
      }}
    >
      {/* Brand and form are ONE block, centred together in the space above the
          footer. Previously the outer column was space-between, which pinned
          the logo to the top of the screen and left it floating a long way
          above "Welcome back" — on a tall window they read as two unrelated
          things rather than one sign-in card. */}
      <Box
        sx={{
          flex: 1,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          py: 4,
        }}
      >
        <Stack spacing={4} sx={{ width: "100%", maxWidth: 420 }}>
          <Stack alignItems="center" spacing={1}>
            <Box
              component="img"
              src={appIconUrl}
              alt="Golf Round Tracker"
              sx={{
                width: 64,
                height: 64,
                borderRadius: 4,
                objectFit: "cover",
                display: "block",
              }}
            />
            <Typography variant="h5" sx={{ fontWeight: 900, fontSize: "32px" }}>
              RoundIQ
            </Typography>
            <Typography variant="body2" color="text.secondary">
              TRACK EVERY ROUND. PLAY YOUR BEST.
            </Typography>
          </Stack>

          <Outlet />
        </Stack>
      </Box>

      <Typography variant="caption" color="text.secondary" align="center">
        Estimated handicap only. Not an official USGA handicap.
      </Typography>
    </Box>
  );
}
