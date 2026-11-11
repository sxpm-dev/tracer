import { useEffect, useState } from 'react';

export type DashboardTheme = 'dark' | 'light';
function preferredTheme(): DashboardTheme {
  if (typeof window === 'undefined') {
    return 'light';
  }
  const embedded = document.documentElement.dataset.dashboardTheme;
  if (embedded === 'dark' || embedded === 'light') {
    return embedded;
  }
  const saved = window.localStorage.getItem('trace-dashboard-theme');
  if (saved === 'light' || saved === 'dark') {
    return saved;
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}
export function useDashboardTheme() {
  const [theme, setTheme] = useState(preferredTheme);
  useEffect(() => {
    window.localStorage.setItem('trace-dashboard-theme', theme);
  }, [theme]);
  return {
    appearanceLabel: theme === 'light' ? 'Dark appearance' : 'Light appearance',
    theme,
    toggleTheme: () => setTheme(theme === 'light' ? 'dark' : 'light'),
  };
}
