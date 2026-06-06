import type { Metadata } from 'next';
import { Geist } from 'next/font/google';
import Link from 'next/link';
import './globals.css';

const geist = Geist({ subsets: ['latin'], variable: '--font-geist-sans' });

export const metadata: Metadata = {
  title: 'EasyReporting',
  description: 'Multi-tenant reporting platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geist.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-50 font-sans text-gray-900">
        <header className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
          <span className="font-bold text-blue-600 text-lg tracking-tight">EasyReporting</span>
          <nav className="flex items-center gap-4 text-sm font-medium">
            <Link href="/" className="text-gray-700 hover:text-blue-600 transition-colors">
              Dashboard
            </Link>
            <Link href="/data" className="text-gray-700 hover:text-blue-600 transition-colors">
              Data
            </Link>
          </nav>
        </header>
        {children}
      </body>
    </html>
  );
}
