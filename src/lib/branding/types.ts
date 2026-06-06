// Per-company branding. Resolved SERVER-SIDE from the authenticated company —
// the client can never request to be styled as another company.
// See docs/design-system.md §6 for the white-label model.

export type ColorMode = 'light' | 'dark';

export interface Branding {
  /** Brand accent — primary buttons, active states, first chart series. Hex. */
  primary: string;
  /** Secondary accent — secondary series, positive deltas. Hex. */
  secondary: string;
  /** Logo shown in the header; null falls back to the product name. */
  logoUrl: string | null;
  /** Display name shown beside/instead of the logo. */
  companyName: string;
  /** CSS font-family stack for --font-brand; null keeps the default font. */
  fontFamily: string | null;
  /** Company's default color mode (a user toggle may still override at runtime). */
  defaultMode: ColorMode;
}
