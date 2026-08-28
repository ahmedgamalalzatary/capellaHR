'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { Trash2 } from 'lucide-react';
import { useState } from 'react';

import { Button, Input, Label, Modal } from '@capella/ui';
import { Select } from '@/components/form/select';

import { ClientPicker, type Client } from '@/features/clients';
import { ServicePicker, type ServiceListItem } from '@/features/catalog';
import { ApiError } from '@/lib/api/client';

import { createBooking, listBookingEmployeeOptions } from '../api/bookings-api';
import type { BookingDto } from '../api/bookings-api';
import { BookingTicket } from './booking-ticket';

export const cairoDateTimeToIso = (value: string) => {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const naive = Date.parse(`${value}:00Z`);
  if (Number.isNaN(naive)) return null;
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Cairo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  // Search the valid offset range so gaps produce no candidate and repeated
  // times deterministically choose the earlier instant.
  const candidates: Date[] = [];
  for (let offsetMinutes = -14 * 60; offsetMinutes <= 14 * 60; offsetMinutes += 1) {
    const candidate = new Date(naive - offsetMinutes * 60_000);
    const parts = formatter.formatToParts(candidate).reduce<Record<string, string>>((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
    const represented = `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
    if (represented === value) candidates.push(candidate);
  }
  return candidates.sort((left, right) => left.getTime() - right.getTime())[0]?.toISOString() ?? null;
};

export function BookingForm({ branchId, onClose, onSaved }: {
  branchId?: number;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
}) {
  const [client, setClient] = useState<Client | null>(null);
  const [services, setServices] = useState<ServiceListItem[]>([]);
  const [preferences, setPreferences] = useState<Record<number, number | undefined>>({});
  const [scheduledAt, setScheduledAt] = useState('');
  const [note, setNote] = useState('');
  const [saved, setSaved] = useState<BookingDto>();
  const employees = useQuery({
    queryKey: ['erp-bookings', 'employee-options', branchId ?? 'own'],
    queryFn: () => listBookingEmployeeOptions(branchId),
  });
  const save = useMutation({
    mutationFn: () => {
      const scheduledAtIso = cairoDateTimeToIso(scheduledAt);
      if (scheduledAtIso === null) throw new Error('Invalid Cairo local time');
      return createBooking({
        ...(branchId === undefined ? {} : { branchId }),
        clientId: client!.id,
        scheduledAt: scheduledAtIso,
        services: services.map(({ id }) => ({
          serviceId: id,
          ...(preferences[id] === undefined ? {} : { preferredEmployeeId: preferences[id] }),
        })),
        ...(note.trim() ? { note: note.trim() } : {}),
      });
    },
    onSuccess: async (booking) => { setSaved(booking); await onSaved(); },
  });
  if (saved) return <Modal title="تذكرة الموعد" onClose={onClose}>
    <div className="space-y-4"><BookingTicket booking={saved} /><div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>إغلاق</Button><Button onClick={() => window.print()}>طباعة التذكرة</Button></div></div>
  </Modal>;
  return <Modal title="حجز موعد جديد" onClose={onClose} className="max-w-2xl">
    <div className="space-y-4">
      <ClientPicker selected={client} onSelect={setClient} {...(branchId === undefined ? {} : { branchId })} />
      <ServicePicker {...(branchId === undefined ? {} : { branchId })} onSelect={(service) => setServices((current) => current.some(({ id }) => id === service.id) ? current : [...current, service])} />
      {services.map((service) => <div key={service.id} className="grid gap-2 rounded-control border border-line p-3 sm:grid-cols-[1fr_16rem_auto] sm:items-center">
        <span>{service.name}</span>
        <Select aria-label={`الموظف المفضل لخدمة ${service.name}`} value={preferences[service.id] ?? ''} onChange={(event) => setPreferences((current) => ({ ...current, [service.id]: event.target.value ? Number(event.target.value) : undefined }))}>
          <option value="">بدون موظف مفضل</option>
          {employees.data?.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}
        </Select>
        <Button variant="ghost" aria-label={`حذف ${service.name}`} onClick={() => setServices((current) => current.filter(({ id }) => id !== service.id))}><Trash2 className="size-4" /></Button>
      </div>)}
      <div className="space-y-1.5"><Label htmlFor="booking-time">التاريخ والوقت</Label><Input id="booking-time" type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></div>
      <div className="space-y-1.5"><Label htmlFor="booking-note">ملاحظة</Label><Input id="booking-note" value={note} onChange={(event) => setNote(event.target.value)} /></div>
      {save.isError ? <p role="alert" className="text-sm text-danger">{save.error instanceof ApiError ? save.error.message : save.error instanceof Error && save.error.message === 'Invalid Cairo local time' ? 'الوقت المحلي غير صالح.' : 'تعذر حفظ الحجز.'}</p> : null}
      <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>إغلاق</Button><Button disabled={!client || !scheduledAt || services.length === 0 || save.isPending} onClick={() => save.mutate()}>حفظ الحجز</Button></div>
    </div>
  </Modal>;
}
