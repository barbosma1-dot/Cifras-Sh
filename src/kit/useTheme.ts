import { useEffect, useState, useCallback } from 'react';
import { getStoredMode, resolveTheme, setThemeMode, subscribeTheme, type ThemeMode } from './theme';

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(getStoredMode);
  const [resolved, setResolved] = useState(() => resolveTheme(getStoredMode()));

  useEffect(
    () =>
      subscribeTheme(() => {
        const m = getStoredMode();
        setModeState(m);
        setResolved(resolveTheme(m));
      }),
    []
  );

  const setMode = useCallback((m: ThemeMode) => setThemeMode(m), []);
  return { mode, resolved, setMode };
}
