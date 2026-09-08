import {
  Box,
  Button,
  Chip,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Stack,
  Typography
} from '@mui/material';
import LogoutRoundedIcon from '@mui/icons-material/LogoutRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { DesktopOnly } from '../components/DesktopOnly';
import appIconUrl from '@/app/assets/AppIcon.png';
import { useAuthStore } from '@/stores/authStore';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useIsSuperAdmin } from '../hooks/useIsAdmin';
import { authService } from '@/services/authService';

interface NavItem {
  value: string;
  label: string;
  /** Match the path exactly. Only /admin needs this — every other section is a
   *  prefix of its own detail routes. */
  exact?: boolean;
}

/**
 * Grouped rather than one flat list: the course tools outnumber everything else
 * and were becoming hard to scan as a row of tabs.
 */
const NAV: Array<{ heading: string; items: NavItem[] }> = [
  {
    heading: 'Admin',
    items: [
      { value: '/admin', label: 'Overview', exact: true },
      { value: '/admin/users', label: 'Users' },
      { value: '/admin/rounds', label: 'Rounds' }
    ]
  },
  {
    heading: 'Courses',
    items: [
      { value: '/admin/courses', label: 'All courses' },
      { value: '/admin/courses/import', label: 'Import' },
      { value: '/admin/courses/state-import', label: 'Bulk import' },
      { value: '/admin/courses/duplicates', label: 'Duplicates' },
      { value: '/admin/courses/tees', label: 'Tee sets' },
      { value: '/admin/review', label: 'Hole review' }
    ]
  }
];

const ALL_ITEMS = NAV.flatMap((g) => g.items);

export function AdminLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const session = useAuthStore((s) => s.session);
  const resetAuth = useAuthStore((s) => s.reset);
  const { data: isSuperAdmin } = useIsSuperAdmin();
  const isDesktop = useIsDesktop();

  // Falls back to the email while the profile row is still loading, so the
  // header never renders an empty name.
  const name =
    [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim() ||
    profile?.email ||
    session?.user.email ||
    'Signed in';

  const signOut = async () => {
    await authService.signOut();
    resetAuth();
    navigate('/auth/login', { replace: true });
  };

  // Most-specific match wins, so /admin/courses/import highlights Import rather
  // than All courses. Sorting by length is what makes that hold no matter what
  // order the groups above are written in.
  const active =
    [...ALL_ITEMS]
      .sort((a, b) => b.value.length - a.value.length)
      .find((t) =>
        t.exact ? location.pathname === t.value : location.pathname.startsWith(t.value)
      )?.value ?? '/admin';

  return (
    <DesktopOnly>
      <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
        {/* The admin panel's own header rather than the app's PageHeader.
            PageHeader is built for a phone screen — one big title, an optional
            back arrow, an action slot — and has nowhere to put a brand mark.
            Here the logo carries the identity, so the "Admin" title moves down
            to sit over the nav where it labels what it actually describes. */}
        <Box
          component="header"
          sx={{
            position: 'sticky',
            top: 0,
            zIndex: (t) => t.zIndex.appBar,
            // Opaque, or content scrolling underneath shows through.
            bgcolor: 'background.default',
            borderBottom: 1,
            borderColor: 'divider',
            display: 'flex',
            alignItems: 'center',
            gap: 1.5,
            px: 2,
            py: 1
          }}
        >
          {/* A back arrow only where it goes somewhere. On a desktop browser
              AuthGuard sends an admin straight from /settings back to /admin,
              so it would loop; on a tablet-sized NATIVE build the app proper is
              still reachable and the arrow stays useful. */}
          {!isDesktop && (
            <IconButton aria-label="Back" onClick={() => navigate('/settings')} sx={{ ml: -1 }}>
              <ArrowBackRoundedIcon />
            </IconButton>
          )}

          <Box
            component="img"
            src={appIconUrl}
            alt="RoundIQ"
            sx={{ width: 32, height: 32, borderRadius: 2, objectFit: 'cover', display: 'block' }}
          />
          <Typography variant="subtitle1" sx={{ fontWeight: 900 }}>
            RoundIQ
          </Typography>

          <Box sx={{ flex: 1 }} />

          <Stack alignItems="flex-end" sx={{ minWidth: 0 }}>
            <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
              {name}
            </Typography>
            <Chip
              size="small"
              variant="outlined"
              color={isSuperAdmin ? 'secondary' : 'primary'}
              label={isSuperAdmin ? 'Super admin' : 'Admin'}
              sx={{ height: 16, fontSize: 9.5, '& .MuiChip-label': { px: 0.75 } }}
            />
          </Stack>

          <Button
            size="small"
            variant="text"
            color="inherit"
            startIcon={<LogoutRoundedIcon sx={{ fontSize: 14 }} />}
            onClick={signOut}
            sx={{
              flexShrink: 0,
              minWidth: 0,
              px: 1,
              py: 0.25,
              fontSize: 11,
              color: 'text.secondary',
              '& .MuiButton-startIcon': { mr: 0.5 }
            }}
          >
            Sign out
          </Button>
        </Box>

        <Box sx={{ display: 'flex', maxWidth: 1400, mx: 'auto', width: '100%' }}>
          <Box
            component="nav"
            sx={{
              width: 190,
              flexShrink: 0,
              borderRight: 1,
              borderColor: 'divider',
              // Full height so the divider runs the length of the page rather
              // than stopping under the last link.
              minHeight: 'calc(100dvh - 64px)',
              py: 1
            }}
          >
            {/* Moved off the header, where the logo now carries the brand. It
                reads better here anyway: it labels the nav beneath it rather
                than floating over the whole page. */}
            <Typography
              variant="h6"
              sx={{ fontWeight: 900, px: 2, pt: 1, pb: 1.5, lineHeight: 1 }}
            >
              Admin
            </Typography>
            {NAV.map((group) => (
              <List
                key={group.heading}
                dense
                disablePadding
                subheader={
                  <ListSubheader
                    disableSticky
                    sx={{ bgcolor: 'transparent', lineHeight: '32px', fontSize: 12 }}
                  >
                    {group.heading}
                  </ListSubheader>
                }
                sx={{ mb: 1 }}
              >
                {group.items.map((item) => (
                  <ListItemButton
                    key={item.value}
                    selected={active === item.value}
                    onClick={() => navigate(item.value)}
                    sx={{
                      py: 0.75,
                      pl: 2.5,
                      borderLeft: 2,
                      borderColor: active === item.value ? 'primary.main' : 'transparent'
                    }}
                  >
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontSize: 14,
                        fontWeight: active === item.value ? 600 : 400
                      }}
                    />
                  </ListItemButton>
                ))}
              </List>
            ))}
          </Box>
          {/* minWidth:0 so a wide table scrolls inside the content column
              instead of pushing the nav off-screen. */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Outlet />
          </Box>
        </Box>
      </Box>
    </DesktopOnly>
  );
}
