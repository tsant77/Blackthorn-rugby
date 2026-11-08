import type { ReactNode } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { EmptyState, LoadingScreen, Shell } from "./components/Shell";
import { DesignPage } from "./pages/DesignPage";
import { HomePage } from "./pages/HomePage";
import { InvitePage } from "./pages/InvitePage";
import { LoginPage } from "./pages/LoginPage";
import { OnboardingPage } from "./pages/OnboardingPage";
import { ProfilePage } from "./pages/ProfilePage";
import { SquadPage } from "./pages/SquadPage";
import { SessionProvider, useSession } from "./session";

export function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <Routes>
          <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
          <Route path="/design" element={<DesignPage />} />
          <Route element={<RequireSession />}>
            <Route element={<Shell />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/log" element={<EmptyState title="Log a workout" body="Logging opens in the next release. Your sessions will score on the server, not in the browser." />} />
              <Route path="/board" element={<EmptyState title="Leaderboard" body="The weekly, monthly, and offseason boards will fill in once workouts are logged. Submitted sessions count immediately." />} />
              <Route path="/activity" element={<EmptyState title="Team activity" body="Teammate sessions will show up here." />} />
              <Route path="/you" element={<ProfilePage />} />
              <Route path="/invite" element={<InvitePage />} />
              <Route path="/squad" element={<SquadPage />} />
              <Route path="/onboarding" element={<OnboardingPage />} />
            </Route>
          </Route>
        </Routes>
      </SessionProvider>
    </ErrorBoundary>
  );
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { me, loading } = useSession();
  if (loading) return <LoadingScreen />;
  if (me?.needsOnboarding) return <Navigate to="/onboarding" replace />;
  if (me) return <Navigate to="/" replace />;
  return children;
}

function RequireSession() {
  const { me, loading, error } = useSession();
  const location = useLocation();
  if (loading) return <LoadingScreen />;
  if (!me) return <Navigate to="/login" replace />;
  if (error) return <EmptyState title="Could not load your session" body={error} />;
  if (me.needsOnboarding && location.pathname !== "/onboarding") return <Navigate to="/onboarding" replace />;
  if (!me.needsOnboarding && location.pathname === "/onboarding") return <Navigate to="/" replace />;
  return <Outlet />;
}
