'use client';

import type { BookingDto } from '@capella/contracts';

import { Barcode } from '@/lib/barcode/render-barcode';
import { PrintPageRule } from '@/lib/print/page-rule';
import { RECEIPT_PAGE_RULE } from '@/lib/print/hardware';

export function BookingTicket({ booking }: { booking: BookingDto }) {
  const code = `BOOK-${booking.id}`;
  const client = booking.client.fullName ?? booking.client.phone ?? 'عميل';
  return <article data-receipt className="mx-auto w-[72mm] space-y-3 bg-paper p-3 text-center text-ink">
    <PrintPageRule rule={RECEIPT_PAGE_RULE} />
    <h2 className="text-lg font-semibold">موعد كابيلا</h2>
    <p className="font-semibold">{client}</p>
    <p className="tabular">{new Intl.DateTimeFormat('ar-EG', {
      timeZone: 'Africa/Cairo', dateStyle: 'full', timeStyle: 'short',
    }).format(new Date(booking.scheduledAt))}</p>
    <ul className="space-y-1">{booking.services.map((service) => <li key={service.serviceId}>{service.serviceName}</li>)}</ul>
    <Barcode value={code} symbology="code128" heightMm={10} className="mx-auto w-56" />
    <p className="font-mono text-xs">{code}</p>
  </article>;
}
