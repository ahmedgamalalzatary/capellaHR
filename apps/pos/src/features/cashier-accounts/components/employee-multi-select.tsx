'use client';

import { ChevronDown, Search } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import { Input, Label } from '@capella/ui';
import type { EmployeeOption } from '../api/employee-options-api';

export function EmployeeMultiSelect({ employees, selected, onChange, disabled }: {
  employees: EmployeeOption[];
  selected: number[];
  onChange: (ids: number[]) => void;
  disabled: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const names = employees.filter(({ id }) => selected.includes(id)).map(({ fullName }) => fullName);
  const filtered = employees.filter(({ fullName }) => fullName.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

  return (
    <div className="space-y-1.5" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
    }} onKeyDown={(event) => {
      if (event.key === 'Escape' && open) {
        event.stopPropagation();
        setOpen(false);
        trigger.current?.focus();
      }
    }}>
      <Label htmlFor={id}>الموظفون المسموح لهم بالبيع</Label>
      <button ref={trigger} id={id} type="button" disabled={disabled}
        aria-label={`الموظفون المسموح لهم بالبيع: ${names.length} محدد`}
        aria-expanded={open} aria-controls={`${id}-options`}
        className="flex min-h-10 w-full items-center justify-between gap-3 rounded-control border border-line bg-paper px-3 py-2 text-start text-sm disabled:opacity-50"
        onClick={() => { setOpen(!open); setSearch(''); }}>
        <span className="truncate">{names.length ? names.join('، ') : 'اختر الموظفين'}</span>
        <ChevronDown className={`size-4 shrink-0 text-muted ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open ? (
        <div id={`${id}-options`} className="rounded-control border border-line bg-paper shadow-card">
          <div className="relative border-b border-line p-2">
            <Search className="pointer-events-none absolute start-5 top-5 size-4 text-muted" aria-hidden />
            <Input type="search" aria-label="البحث عن موظف" placeholder="ابحث باسم الموظف" className="ps-9"
              value={search} disabled={disabled} onChange={(event) => setSearch(event.target.value)} />
          </div>
          <div role="group" aria-label="اختيار الموظفين" className="max-h-48 overflow-y-auto p-1">
            {filtered.map((employee) => (
              <label key={employee.id} className="flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 text-sm hover:bg-surface">
                <input type="checkbox" className="size-4 accent-[color:var(--color-ink)]" disabled={disabled}
                  checked={selected.includes(employee.id)} onChange={() => onChange(selected.includes(employee.id)
                    ? selected.filter((id) => id !== employee.id) : [...selected, employee.id])} />
                {employee.fullName}
              </label>
            ))}
            {filtered.length === 0 ? <p className="px-3 py-4 text-sm text-muted">لا توجد نتائج</p> : null}
          </div>
        </div>
      ) : null}
      <p className="text-xs text-muted">{selected.length} موظف محدد — يمكنك اختيار أكثر من موظف.</p>
    </div>
  );
}
