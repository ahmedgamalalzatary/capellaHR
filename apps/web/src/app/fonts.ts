import type { CSSProperties } from 'react';
import { Noto_Sans_Arabic } from 'next/font/google';

/*
 * Body and board/heading faces (tokens.css reads --font-body-face, --font-display-face and
 * --display-stretch). Default pair until the owner's pick on /_design: Noto Sans Arabic, with
 * its own condensed width for the board and headings.
 */
const notoArabic = Noto_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  axes: ['wdth'],
  variable: '--font-body-face',
  display: 'swap',
});

export const fontClassName = notoArabic.variable;

export const fontStyle = {
  '--font-display-face': 'var(--font-body-face)',
  '--display-stretch': '80%',
} as CSSProperties;
