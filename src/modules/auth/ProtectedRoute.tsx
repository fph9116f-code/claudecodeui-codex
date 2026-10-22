import type { ReactNode } from 'react';

import { useAuth } from '@/modules/auth/context/AuthContext';
import { Onboarding } from '@/modules/onboarding';
import AuthLoadingScreen from '@/modules/auth/AuthLoadingScreen';

type ProtectedRouteProps = {
  children: ReactNode;
};

/**
 * Used by App to gate the routed application behind the first-run onboarding
 * flow. Login was removed, so there is no account or session to check.
 */
export default function ProtectedRoute({ children }: ProtectedRouteProps) {
  const { isLoading, hasCompletedOnboarding, refreshOnboardingStatus } = useAuth();

  if (isLoading) {
    return <AuthLoadingScreen />;
  }

  if (!hasCompletedOnboarding) {
    return <Onboarding onComplete={refreshOnboardingStatus} />;
  }

  return <>{children}</>;
}
