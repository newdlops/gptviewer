import type { ThemeMode } from '../types/chat';

export const detectInitialTheme = (): ThemeMode => {
  const storedTheme = window.localStorage.getItem('theme-mode');
  if (storedTheme === 'dark' || storedTheme === 'light') {
    return storedTheme;
  }

  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
};
