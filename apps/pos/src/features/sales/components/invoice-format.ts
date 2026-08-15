import type { PaymentMethod } from '@capella/contracts';

export const paymentLabels: Record<PaymentMethod, string> = {
  cash: 'نقدي',
  visa: 'فيزا',
  instapay: 'إنستا باي',
  vodafone_cash: 'فودافون كاش',
};

export const formatCairoDateTime = (value: string) => new Intl.DateTimeFormat('ar-EG', {
  timeZone: 'Africa/Cairo',
  dateStyle: 'medium',
  timeStyle: 'short',
}).format(new Date(value));

export const requestReference = (error: unknown) => {
  const requestId = typeof error === 'object' && error !== null
    ? Reflect.get(error, 'requestId')
    : undefined;
  return typeof requestId === 'string' ? requestId : null;
};

export const responseMessage = (error: unknown, fallback: string) => {
  if (typeof error !== 'object' || error === null) return fallback;
  const status = Reflect.get(error, 'status');
  const message = Reflect.get(error, 'message');
  return typeof status === 'number' && typeof message === 'string' && message.trim().length > 0
    ? message
    : fallback;
};
