const CAIRO_TIME_ZONE = 'Africa/Cairo';
const MAX_MYSQL_INT = 2_147_483_647;

type CairoParts = {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
};

const cairoParts = (instant: Date): CairoParts => {
  if (Number.isNaN(instant.getTime())) throw new Error('Invalid invoice timestamp');
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: CAIRO_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes) => {
    const value = parts.find((part) => part.type === type)?.value;
    if (!value) throw new Error(`Missing Cairo ${type}`);
    return value;
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
  };
};

export const cairoBusinessDate = (instant: Date) => {
  const { year, month, day } = cairoParts(instant);
  return `${year}-${month}-${day}`;
};

export const formatInvoiceNumber = (instant: Date, sequence: number) => {
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > MAX_MYSQL_INT) {
    throw new Error('Invalid invoice sequence value');
  }
  const { year, month, day, hour, minute } = cairoParts(instant);
  return `INV-${year}.${month}.${day}-${hour}.${minute}-${sequence}`;
};

export type InvoiceSequenceStore = {
  allocate(businessDate: string, allocatedAt: Date): Promise<number>;
};

export const createInvoiceNumberAllocator = (
  store: InvoiceSequenceStore,
  now: () => Date = () => new Date(),
) => ({
  async allocate() {
    const allocatedAt = now();
    const businessDate = cairoBusinessDate(allocatedAt);
    // The store commits before returning. A later failed sale therefore leaves
    // a permitted gap instead of making this invoice number reusable.
    const sequence = await store.allocate(businessDate, allocatedAt);
    return {
      businessDate,
      sequence,
      invoiceNumber: formatInvoiceNumber(allocatedAt, sequence),
      allocatedAt,
    };
  },
});
