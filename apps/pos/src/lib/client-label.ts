/**
 * What to call a client on screen and on paper. A record always carries a name or
 * a number, so the number stands in as the label when the name was never taken.
 */
export const clientLabel = (client: { fullName: string | null; phone: string | null }) => (
  client.fullName ?? client.phone ?? 'عميل بدون اسم'
);

/** The same rule for an invoice's stored snapshot of the client. */
export const invoiceClientLabel = (client: { name: string | null; phone?: string | null }) => (
  client.name ?? client.phone ?? 'عميل بدون اسم'
);
