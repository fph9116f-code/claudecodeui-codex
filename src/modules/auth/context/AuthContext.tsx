import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import { api } from '@/shared/api';
import { hydrateChatDrafts } from '@/shared/chatDrafts';
import { hydrateUserPreferences } from '@/shared/userSettings';

type OnboardingStatusPayload = {
  hasCompletedOnboarding?: boolean;
};

type AuthContextValue = {
  isLoading: boolean;
  hasCompletedOnboarding: boolean;
  refreshOnboardingStatus: () => Promise<void>;
};

type AuthProviderProps = {
  children: ReactNode;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}

/**
 * Used by App to bootstrap the implicit local session: login was removed, so
 * this provider only hydrates the local user's server-side preferences and
 * drafts and exposes the onboarding state to the route gate.
 */
export function AuthProvider({ children }: AuthProviderProps) {
  // Loading covers the initial onboarding-status request; ProtectedRoute shows
  // the splash screen until the first-run decision is known.
  const [isLoading, setIsLoading] = useState(true);
  // Whether the implicit local user finished the first-run setup wizard.
  const [hasCompletedOnboarding, setHasCompletedOnboarding] = useState(true);

  const checkOnboardingStatus = useCallback(async () => {
    try {
      const response = await api.user.onboardingStatus();
      if (!response.ok) {
        return;
      }

      const payload = (await response.json()) as OnboardingStatusPayload;
      setHasCompletedOnboarding(Boolean(payload?.hasCompletedOnboarding));
    } catch (error) {
      console.error('Error checking onboarding status:', error);
      // Fail open to avoid blocking access on transient onboarding status errors.
      setHasCompletedOnboarding(true);
    }
  }, []);

  const refreshOnboardingStatus = useCallback(async () => {
    await checkOnboardingStatus();
  }, [checkOnboardingStatus]);

  useEffect(() => {
    // Preferences and drafts live in the server database for the implicit local
    // user, so hydrate them once at startup instead of on a sign-in event.
    void hydrateUserPreferences();
    void hydrateChatDrafts();
    void checkOnboardingStatus().finally(() => setIsLoading(false));
  }, [checkOnboardingStatus]);

  const contextValue = useMemo<AuthContextValue>(
    () => ({
      isLoading,
      hasCompletedOnboarding,
      refreshOnboardingStatus,
    }),
    [hasCompletedOnboarding, isLoading, refreshOnboardingStatus],
  );

  return <AuthContext.Provider value={contextValue}>{children}</AuthContext.Provider>;
}
