import type { Metadata } from 'next';
import type { CSSProperties } from 'react';
import { Nunito } from 'next/font/google';
import './globals.css';
import Nav from '@/components/Nav';
import ThemeToggle from '@/components/ThemeToggle';
import { getUserContext } from '@/lib/auth/getUserContext';
import { getBranding, readableForeground } from '@/lib/branding/getBranding';

// Nunito: a rounded, humanist sans — warm and friendly, suits a customer
// portal far better than a technical grotesk. Companies can still override
// the family via branding (--font-brand).
const appFont = Nunito({ subsets: ['latin'], variable: '--font-app-sans' });

export const metadata: Metadata = {
  title: 'EasyReporting',
  description: 'Multi-tenant reporting platform',
};

// Applies the user's saved theme before first paint to avoid a flash, falling
// back to the company default already rendered on <html>.
const noFlashTheme = `(function(){try{var t=localStorage.getItem('er-theme');if(t){document.documentElement.dataset.theme=t;}}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Branding is resolved server-side from the authenticated company — never the client.
  const ctx = await getUserContext();
  const branding = await getBranding(ctx.tenantId);

  const brandVars = {
    '--primary': branding.primary,
    '--primary-foreground': readableForeground(branding.primary),
    '--secondary': branding.secondary,
    '--secondary-foreground': readableForeground(branding.secondary),
    ...(branding.fontFamily ? { '--font-brand': branding.fontFamily } : {}),
  } as CSSProperties;

  return (
    <html
      lang="en"
      data-theme={branding.defaultMode}
      style={brandVars}
      suppressHydrationWarning
      className={`${appFont.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: noFlashTheme }} />
      </head>
      <body className="min-h-full flex flex-col bg-background font-sans text-foreground">
        <header className="sticky top-0 z-40 flex items-center gap-6 bg-primary px-6 py-3 text-primary-foreground shadow-card">
          <div className="flex items-center gap-2">
            {branding.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={branding.logoUrl} alt={branding.companyName} className="h-6 w-auto" />
            ) : (
              <span className="text-lg font-bold tracking-tight text-primary-foreground">
                {branding.companyName}
              </span>
            )}
          </div>
          <div className="flex flex-1 items-center justify-between">
            <Nav />
            <ThemeToggle />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
