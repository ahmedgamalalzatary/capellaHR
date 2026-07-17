import type { Metadata } from 'next';

import { PairDeviceView } from '@/features/devices/components/pair-device-view';

export const metadata: Metadata = { title: 'ربط جهاز' };

export default async function PairPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <PairDeviceView token={token} />;
}
