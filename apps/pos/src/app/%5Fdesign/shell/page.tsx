import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ShellPreview } from './shell-preview';

export const metadata: Metadata = { title: 'معاينة إطار التطبيق' };

/** Dev-only: the shared AppShell at every width, admin and cashier. */
export default function ShellPreviewPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <ShellPreview />;
}
