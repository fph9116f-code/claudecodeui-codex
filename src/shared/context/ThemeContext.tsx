import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';

import type { AppearanceTheme, ThemeMode } from '@/shared/types';
import {
  readUserPreference,
  subscribeToUserPreferences,
  writeUserPreferences,
} from '@/shared/userSettings';

type ThemeContextValue = {
  appearanceTheme: AppearanceTheme;
  setAppearanceTheme: (theme: AppearanceTheme) => void;
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Reads the stored preference as a theme mode.
 *
 * Only the modes this client knows are accepted. Anything else —
 * an absent value, or a value a newer client wrote — means "follow the OS",
 * which is also the default.
 */
const readStoredThemeMode = (): ThemeMode => {
  const savedTheme = readUserPreference<string | null>('theme', null);
  return savedTheme === 'dark' || savedTheme === 'light'
    ? savedTheme
    : 'system';
};

/** Whether an OS appearance change should repaint the current mode. */
const followsSystemAppearance = (mode: ThemeMode): boolean =>
  mode === 'system';

/** Whether the OS currently asks for a dark appearance; false when unknown. */
const prefersDarkAppearance = (): boolean =>
  Boolean(window.matchMedia?.('(prefers-color-scheme: dark)').matches);

/** The colour a mode resolves to right now. */
const resolveIsDarkMode = (mode: ThemeMode): boolean =>
  followsSystemAppearance(mode) ? prefersDarkAppearance() : mode === 'dark';

/** 供设置、编辑器、终端等模块读取并调整外观与颜色。 */
export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return context;
};

/** 兼容旧版草稿主题；读取时不写入偏好。 */
const readStoredAppearanceTheme = (): AppearanceTheme => {
  const appearance = readUserPreference<string | null>('appearanceTheme', null);
  if (appearance === 'codex' || appearance === 'default') return appearance;
  return readUserPreference<string>('theme', '') === 'codex' ? 'codex' : 'default';
};

/** 供 sidebar、chat 等可独立渲染的模块读取外观，未挂载 Provider 时使用默认风格。 */
export const useOptionalAppearanceTheme = (): AppearanceTheme =>
  useContext(ThemeContext)?.appearanceTheme ?? 'default';

/** Mounted once by App so every module can read and switch the colour theme through useTheme. */
export const ThemeProvider = ({ children }: { children: ReactNode }) => {
  // The mode the user chose, not the colour it currently resolves to: only the
  // mode is persisted, and `system` has to keep tracking the OS afterwards.
  // Read synchronously from the preference mirror so the very first paint is
  // already the right colour.
  // 界面风格与颜色分别持久化，切换深浅色时保持布局。
  const [appearanceTheme, setAppearanceThemeState] = useState<AppearanceTheme>(readStoredAppearanceTheme);
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readStoredThemeMode);
  // The resolved colour. It is not derivable from `themeMode` alone, because
  // under `system` it changes when the OS does, with no state change here.
  const [isDarkMode, setIsDarkMode] = useState(() => resolveIsDarkMode(readStoredThemeMode()));

  // The theme now lives in auth.db, so a change made on another device (or in
  // another tab) arrives through the preference store rather than a re-render.
  useEffect(() => subscribeToUserPreferences(() => {
    const storedMode = readStoredThemeMode();
    setAppearanceThemeState(readStoredAppearanceTheme());
    setThemeModeState(storedMode);
    setIsDarkMode(resolveIsDarkMode(storedMode));
  }), []);

  // Applying the theme to the document and persisting it are deliberately
  // separate. Persisting from here would also fire on mount — before the stored
  // theme had been fetched — writing this device's system default over the
  // theme the user actually chose on another one.
  useEffect(() => {
    // The Codex option is a visual theme, not a colour; `.dark` still decides
    // whether it paints its light or dark variant.
    const isCodex = appearanceTheme === 'codex';
    document.documentElement.classList.toggle('codex', isCodex);

    if (isDarkMode) {
      document.documentElement.classList.add('dark');

      // Update iOS status bar style and theme color for dark mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'black-translucent');
      }

      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', isCodex ? '#1a1a18' : '#141414'); // Codex dark canvas / default dark background
      }
    } else {
      document.documentElement.classList.remove('dark');

      // Update iOS status bar style and theme color for light mode
      const statusBarMeta = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
      if (statusBarMeta) {
        statusBarMeta.setAttribute('content', 'default');
      }

      const themeColorMeta = document.querySelector('meta[name="theme-color"]');
      if (themeColorMeta) {
        themeColorMeta.setAttribute('content', isCodex ? '#ffffff' : '#f6f4ef'); // Codex canvas / default light background
      }
    }
  }, [isDarkMode, appearanceTheme]);

  // Listen for system theme changes
  useEffect(() => {
    if (!window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleChange = (e: MediaQueryListEvent) => {
      // Re-read rather than close over `themeMode`: a change that arrived from
      // another device lands in the store first. Only modes that follow the OS
      // repaint.
      if (followsSystemAppearance(readStoredThemeMode())) {
        setIsDarkMode(e.matches);
      }
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  /** 设置颜色时同时保存当前外观，兼容尚未完成迁移的旧草稿。 */
  const setThemeMode = useCallback((mode: ThemeMode) => {
    writeUserPreferences({ theme: mode, appearanceTheme: readStoredAppearanceTheme() });
  }, []);

  const setAppearanceTheme = useCallback((appearance: AppearanceTheme) => {
    writeUserPreferences({ appearanceTheme: appearance, theme: readStoredThemeMode() });
  }, []);

  const toggleDarkMode = useCallback(() => {
    setThemeMode(resolveIsDarkMode(readStoredThemeMode()) ? 'light' : 'dark');
  }, [setThemeMode]);

  // A fresh object here would re-render every consumer in the app on any
  // render of this provider, theme change or not.
  const value = useMemo<ThemeContextValue>(
    () => ({ appearanceTheme, setAppearanceTheme, isDarkMode, toggleDarkMode, themeMode, setThemeMode }),
    [appearanceTheme, setAppearanceTheme, isDarkMode, toggleDarkMode, themeMode, setThemeMode],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};
