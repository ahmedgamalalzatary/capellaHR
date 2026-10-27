import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { BookingRefundConfirm } from '../src/features/bookings/components/booking-money-dialogs';

afterEach(cleanup);

it('locks the refund methods while saving the confirmed refund', () => {
  const confirm = vi.fn();
  render(<BookingRefundConfirm title="إلغاء حجز" description="تأكيد رد المبلغ" confirmLabel="تأكيد الإلغاء" amount="100.00" cashierSessionId={5} pending onConfirm={confirm} onCancel={() => undefined} />);
  expect(screen.getByLabelText('رد نقدي')).toHaveProperty('disabled', true);
  expect(screen.getByLabelText('رد فيزا')).toHaveProperty('disabled', true);
  fireEvent.click(screen.getByRole('button', { name: 'نعم، أعدت المال — تأكيد الإلغاء' }));
  expect(confirm).not.toHaveBeenCalled();
});
