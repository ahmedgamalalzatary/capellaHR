import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';

import { AppProviders } from '@/providers';

import '@/styles/globals.css';

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'كابيلا — نظام الموارد البشرية',
    template: '%s — كابيلا',
  },
  description: 'نظام إدارة الموارد البشرية والحضور والرواتب',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={plexArabic.variable}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
