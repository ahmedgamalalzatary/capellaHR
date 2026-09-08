import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = { title: 'الخدمات' };

/** Leftover cashier browse page: the live catalog lives under /catalog. */
export default function ServicesPage() {
  redirect('/catalog');
}
