// Branding seam. Like DataProvider, this is the single place to swap how
// per-company branding is sourced (config file, DB table, CMS, ...).
// The default implementation returns the product's house brand for every
// company; real deployments replace the lookup body.
//
// IMPORTANT: callers must pass the companyId from the server-resolved
// UserContext (never from client input) — see docs/design-system.md §6.
import type { Branding } from './types';

export const DEFAULT_BRANDING: Branding = {
  primary: '#005FA1',
  secondary: '#76B729',
  logoUrl: null,
  companyName: 'EasyReporting',
  fontFamily: null,
  defaultMode: 'light',
};

/** Per-company overrides keyed by companyId/tenantId. Demo data for now. */
const BRANDING_BY_COMPANY: Record<string, Partial<Branding>> = {
  // Example of how a tenant rebrands the whole app by changing a few values:
  globex: { companyName: 'Globex', primary: '#7c3aed', secondary: '#f59e0b' },
};

export async function getBranding(companyId: string): Promise<Branding> {
  const overrides = BRANDING_BY_COMPANY[companyId] ?? {};
  return { ...DEFAULT_BRANDING, ...overrides };
}

/**
 * Pick a legible foreground (black/white) for text on top of a brand color,
 * using WCAG relative luminance. Guards the contrast guardrail in §6/§8 so an
 * arbitrary brand color never yields unreadable button text.
 */
export function readableForeground(hex: string): string {
  const c = hex.replace('#', '');
  const full = c.length === 3 ? c.split('').map((ch) => ch + ch).join('') : c;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const lin = (v: number) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  // Contrast vs white = 1.05 / (L+0.05); vs black = (L+0.05) / 0.05.
  return luminance > 0.4 ? '#0f1b2d' : '#ffffff';
}
