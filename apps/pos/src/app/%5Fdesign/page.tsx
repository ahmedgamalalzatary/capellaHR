import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { Beiruti, Changa, IBM_Plex_Sans_Arabic, Noto_Sans_Arabic, Readex_Pro } from 'next/font/google';

import { DesignPreview, type FontPair } from './design-preview';

export const metadata: Metadata = { title: 'معاينة نظام التصميم' };

/* Candidate faces, loaded only on this preview page. The chosen pair moves to src/app/fonts.ts. */
const notoArabic = Noto_Sans_Arabic({ subsets: ['arabic', 'latin'], axes: ['wdth'], variable: '--cand-noto', display: 'swap' });
const changa = Changa({ subsets: ['arabic', 'latin'], variable: '--cand-changa', display: 'swap' });
const plexArabic = IBM_Plex_Sans_Arabic({ subsets: ['arabic', 'latin'], weight: ['400', '500', '600', '700'], variable: '--cand-plex', display: 'swap' });
const beiruti = Beiruti({ subsets: ['arabic', 'latin'], variable: '--cand-beiruti', display: 'swap' });
const readex = Readex_Pro({ subsets: ['arabic', 'latin'], variable: '--cand-readex', display: 'swap' });

const pairs: FontPair[] = [
  {
    id: 'a',
    name: 'أ — Noto Sans Arabic (مكثّف للوحة والعناوين + عادي للنص)',
    display: 'var(--cand-noto)',
    body: 'var(--cand-noto)',
    stretch: '80%',
  },
  {
    id: 'b',
    name: 'ب — Changa للوحة والعناوين + IBM Plex Sans Arabic للنص (الخط الحالي)',
    display: 'var(--cand-changa)',
    body: 'var(--cand-plex)',
    stretch: '100%',
  },
  {
    id: 'c',
    name: 'ج — Beiruti للوحة والعناوين + Readex Pro للنص',
    display: 'var(--cand-beiruti)',
    body: 'var(--cand-readex)',
    stretch: '100%',
  },
];

/** Dev-only review page for the design system (plan §7, 2.8). */
export default function DesignPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  const fontVariables = [notoArabic, changa, plexArabic, beiruti, readex].map((font) => font.variable).join(' ');
  return (
    <div className={fontVariables}>
      <DesignPreview pairs={pairs} />
    </div>
  );
}
