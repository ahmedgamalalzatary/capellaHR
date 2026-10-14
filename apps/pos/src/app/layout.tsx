import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { AppProviders } from '@/providers';

import '@/styles/globals.css';

import { fontClassName, fontStyle } from './fonts';

export const metadata: Metadata = {
  title: {
    default: 'كابيلا — نقطة البيع',
    template: '%s — كابيلا',
  },
  description: 'نظام نقطة البيع لصالون كابيلا',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="ar" dir="rtl" className={fontClassName} style={fontStyle}>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
