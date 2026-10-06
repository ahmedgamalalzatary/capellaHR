export const erpPaymentMethods = ['cash', 'visa', 'instapay', 'vodafone_cash'] as const;
/** Invoice payments may additionally settle from held booking money; never a till input. */
export const invoicePaymentMethods = [...erpPaymentMethods, 'booking_credit'] as const;
