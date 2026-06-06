'use client';

import { useEffect, useState } from 'react';
import type { ColorMode } from '@/lib/branding/types';

const STORAGE_KEY = 'er-theme';

export default function ThemeToggle() {
  const [mode, setMode] = useState<ColorMode | null>(null);

  // Read whatever the no-flash script already applied to <html>.
  useEffect(() => {
    const current = (document.documentElement.dataset.theme as ColorMode) ?? 'light';
    setMode(current);
  }, []);

  const toggle = () => {
    const next: ColorMode = mode === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // ignore storage failures
    }
    setMode(next);
  };

  return (
    <button
      onClick={toggle}
      aria-label={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      className="rounded-full border border-white/30 px-3 py-1.5 text-sm text-primary-foreground/90 transition-colors hover:bg-white/10 hover:text-primary-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
    >
      {mode === 'dark' ? 'Light' : 'Dark'}
    </button>
  );
}
