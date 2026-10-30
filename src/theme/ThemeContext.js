import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { THEMES, DEFAULT_THEME } from './themes';

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [themeId, setThemeId] = useState(DEFAULT_THEME);

  useEffect(() => {
    AsyncStorage.getItem('app-theme').then((v) => {
      if (v && THEMES[v]) setThemeId(v);
    }).catch(() => {});
  }, []);

  const applyTheme = useCallback((id, persist = true) => {
    if (!THEMES[id]) return;
    setThemeId(id);
    if (persist) AsyncStorage.setItem('app-theme', id).catch(() => {});
  }, []);

  const value = useMemo(() => ({ themeId, theme: THEMES[themeId] || THEMES[DEFAULT_THEME], applyTheme }), [themeId, applyTheme]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
