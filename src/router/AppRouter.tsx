import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthGuard, PublicOnlyGuard } from '@/features/auth/AuthGuard';
import { AuthLayout } from '@/pages/auth/AuthLayout';
import { LoginPage } from '@/pages/auth/LoginPage';
import { SignUpPage } from '@/pages/auth/SignUpPage';
import { ForgotPasswordPage } from '@/pages/auth/ForgotPasswordPage';
import { MobileShell } from '@/components/layout/MobileShell';
import { RequireMode } from '@/features/appMode/RequireMode';
import { RequireScorer } from '@/features/appMode/RequireScorer';
import { ModeChooserPage } from '@/pages/ModeChooserPage';
import { HomePage } from '@/pages/HomePage';
import { BagPage } from '@/pages/bag/BagPage';
import { RoundHomePage } from '@/pages/round/RoundHomePage';
import { StartRoundPage } from '@/pages/round/StartRoundPage';
import { RoundSetupPage } from '@/pages/round/RoundSetupPage';
import { ManualCoursePage } from '@/pages/round/ManualCoursePage';
import { HoleTrackingPage } from '@/pages/round/HoleTrackingPage';
import { RoundSummaryPage } from '@/pages/round/RoundSummaryPage';
import { PastRoundsPage } from '@/pages/round/PastRoundsPage';
import { MyTournamentsPage } from '@/pages/tournaments/MyTournamentsPage';
import { ScorerAssignmentsPage } from '@/pages/tournaments/ScorerAssignmentsPage';
import { ScorerGroupPage } from '@/pages/tournaments/ScorerGroupPage';
import { StatsPage } from '@/pages/stats/StatsPage';
import { SettingsPage } from '@/pages/settings/SettingsPage';
import { WatchPage } from '@/pages/watch/WatchPage';
import { PracticeStartPage } from '@/pages/practice/PracticeStartPage';
import { PracticeLivePage } from '@/pages/practice/PracticeLivePage';
import { SessionSummaryPage } from '@/pages/practice/SessionSummaryPage';
import { PastPracticesPage } from '@/pages/practice/PastPracticesPage';
import { PracticeSessionDetailPage } from '@/pages/practice/PracticeSessionDetailPage';
import { SwingMetricsGuidePage } from '@/pages/practice/SwingMetricsGuidePage';
import { RangeSessionPage } from '@/pages/range/RangeSessionPage';
import { RangeSummaryPage } from '@/pages/range/RangeSummaryPage';
import { RangeGuidePage } from '@/pages/range/RangeGuidePage';
import { DrillsPage } from '@/pages/range/DrillsPage';
import { DrillRunnerPage } from '@/pages/range/DrillRunnerPage';
import { DrillReportPage } from '@/pages/range/DrillReportPage';
import { OnboardingPage } from '@/pages/onboarding/OnboardingPage';
import { AdminGuard } from '@/admin/AdminGuard';
import { AdminLayout } from '@/admin/pages/AdminLayout';
import { AdminOverview } from '@/admin/pages/AdminOverview';
import { AdminCoursesList } from '@/admin/pages/AdminCoursesList';
import { AdminImport } from '@/admin/pages/AdminImport';
import { AdminStateImport } from '@/admin/pages/AdminStateImport';
import { AdminCourseDetail } from '@/admin/pages/AdminCourseDetail';
import { AdminReview } from '@/admin/pages/AdminReview';
import { AdminUsersList } from '@/admin/pages/AdminUsersList';
import { AdminUserDetail } from '@/admin/pages/AdminUserDetail';
import { AdminRounds } from '@/admin/pages/AdminRounds';
import { AdminRoundDetail } from '@/admin/pages/AdminRoundDetail';

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/auth"
        element={
          <PublicOnlyGuard>
            <AuthLayout />
          </PublicOnlyGuard>
        }
      >
        <Route index element={<Navigate to="login" replace />} />
        <Route path="login" element={<LoginPage />} />
        <Route path="signup" element={<SignUpPage />} />
        <Route path="forgot-password" element={<ForgotPasswordPage />} />
      </Route>

      {/* Tournaments or Golf Rounds. Unset on every launch, so this is the first
          authenticated screen — it resolves itself when there's nothing to ask. */}
      <Route
        path="/choose"
        element={
          <AuthGuard>
            <ModeChooserPage />
          </AuthGuard>
        }
      />

      {/* Playing and reviewing a round belong to both sides — a tournament round
          is tracked on the same screens as a casual one. */}
      <Route
        path="/round/play"
        element={
          <AuthGuard>
            <HoleTrackingPage />
          </AuthGuard>
        }
      />
      <Route
        path="/round/summary/:roundId"
        element={
          <AuthGuard>
            <RoundSummaryPage />
          </AuthGuard>
        }
      />

      {/* Starting a round is three screens: pick the course, then set the tee
          and hole count, then play. `manual` is the escape hatch for a course
          that's in neither the library nor GolfCourseAPI — it's declared before
          the `:courseId` route so "manual" isn't swallowed as a course id. */}
      <Route
        path="/round/start"
        element={
          <AuthGuard>
            <RequireMode mode="rounds">
              <StartRoundPage />
            </RequireMode>
          </AuthGuard>
        }
      />
      <Route
        path="/round/start/manual"
        element={
          <AuthGuard>
            <RequireMode mode="rounds">
              <ManualCoursePage />
            </RequireMode>
          </AuthGuard>
        }
      />
      <Route
        path="/round/start/:courseId"
        element={
          <AuthGuard>
            <RequireMode mode="rounds">
              <RoundSetupPage />
            </RequireMode>
          </AuthGuard>
        }
      />
      <Route
        path="/round/history"
        element={
          <AuthGuard>
            <RequireMode mode="rounds">
              <PastRoundsPage />
            </RequireMode>
          </AuthGuard>
        }
      />
      <Route
        path="/scoring/:teeGroupId"
        element={
          <AuthGuard>
            <RequireMode mode="tournament">
              <RequireScorer>
                <ScorerGroupPage />
              </RequireScorer>
            </RequireMode>
          </AuthGuard>
        }
      />
      <Route
        path="/watch"
        element={
          <AuthGuard>
            <RequireMode mode="rounds">
              <WatchPage />
            </RequireMode>
          </AuthGuard>
        }
      />
      {/* Practice, range and drills are rounds-side training tools. */}
      {[
        { path: '/practice', element: <PracticeStartPage /> },
        { path: '/practice/live', element: <PracticeLivePage /> },
        { path: '/practice/summary', element: <SessionSummaryPage /> },
        { path: '/practice/guide', element: <SwingMetricsGuidePage /> },
        { path: '/practice/history', element: <PastPracticesPage /> },
        { path: '/practice/history/:sessionId', element: <PracticeSessionDetailPage /> },
        { path: '/range', element: <RangeSessionPage /> },
        { path: '/range/summary/:sessionId', element: <RangeSummaryPage /> },
        { path: '/range/guide', element: <RangeGuidePage /> },
        { path: '/drills', element: <DrillsPage /> },
        { path: '/drills/run', element: <DrillRunnerPage /> },
        { path: '/drills/report/:sessionId', element: <DrillReportPage /> }
      ].map((r) => (
        <Route
          key={r.path}
          path={r.path}
          element={
            <AuthGuard>
              <RequireMode mode="rounds">{r.element}</RequireMode>
            </AuthGuard>
          }
        />
      ))}
      <Route
        path="/onboarding"
        element={
          <AuthGuard>
            <OnboardingPage />
          </AuthGuard>
        }
      />

      <Route
        element={
          <AuthGuard>
            <MobileShell />
          </AuthGuard>
        }
      >
        {/* Golf Rounds side */}
        <Route
          path="/"
          element={
            <RequireMode mode="rounds">
              <HomePage />
            </RequireMode>
          }
        />
        <Route
          path="/round"
          element={
            <RequireMode mode="rounds">
              <RoundHomePage />
            </RequireMode>
          }
        />
        <Route
          path="/stats"
          element={
            <RequireMode mode="rounds">
              <StatsPage />
            </RequireMode>
          }
        />
        <Route
          path="/bag"
          element={
            <RequireMode mode="rounds">
              <BagPage />
            </RequireMode>
          }
        />

        {/* Tournament side */}
        <Route
          path="/tournaments"
          element={
            <RequireMode mode="tournament">
              <MyTournamentsPage />
            </RequireMode>
          }
        />
        <Route
          path="/scoring"
          element={
            <RequireMode mode="tournament">
              <RequireScorer>
                <ScorerAssignmentsPage />
              </RequireScorer>
            </RequireMode>
          }
        />

        {/* Shared by both sides */}
        <Route path="/settings" element={<SettingsPage />} />
      </Route>

      <Route
        path="/admin"
        element={
          <AdminGuard>
            <AdminLayout />
          </AdminGuard>
        }
      >
        <Route index element={<AdminOverview />} />
        <Route path="users" element={<AdminUsersList />} />
        <Route path="users/:id" element={<AdminUserDetail />} />
        <Route path="rounds" element={<AdminRounds />} />
        <Route path="rounds/:roundId" element={<AdminRoundDetail />} />
        <Route path="courses" element={<AdminCoursesList />} />
        <Route path="courses/import" element={<AdminImport />} />
        <Route path="courses/state-import" element={<AdminStateImport />} />
        <Route path="courses/:id" element={<AdminCourseDetail />} />
        <Route path="review" element={<AdminReview />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
