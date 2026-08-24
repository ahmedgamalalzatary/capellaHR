import { BookingsView } from '@/features/bookings';

const cairoDate = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date());

export default function BookingsPage() {
  return <BookingsView initialDate={cairoDate()} />;
}
