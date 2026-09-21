'use client';

import { Check, ChevronsUpDown, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';

import { Input } from '@capella/ui';

export interface ProductComboboxItem {
  id: number;
  name: string;
  barcode: string | null;
  quantity?: number | undefined;
}

interface ProductComboboxProps {
  id: string;
  label: string;
  products: ProductComboboxItem[];
  value: string;
  disabled?: boolean | undefined;
  onChange: (productId: string) => void;
}

/**
 * Select + search in one control: a button shows the chosen product,
 * opening it reveals a search field that filters by name or barcode.
 * Shared by stock transfers and supplier invoices so both pick products one way.
 */
export function ProductCombobox({ id, label, products, value, disabled, onChange }: ProductComboboxProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const selectedName = products.find((product) => String(product.id) === value)?.name;
  const normalizedSearch = search.trim().toLocaleLowerCase('ar');
  const matches = normalizedSearch
    ? products.filter((product) => product.name.toLocaleLowerCase('ar').includes(normalizedSearch)
      || product.barcode?.toLocaleLowerCase('ar').includes(normalizedSearch))
    : products;

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', closeOutside);
    return () => document.removeEventListener('mousedown', closeOutside);
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        id={id}
        type="button"
        role="combobox"
        aria-label={label}
        aria-expanded={open}
        aria-controls={`${id}-options`}
        disabled={disabled}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-control border border-line bg-paper px-3 text-sm text-ink disabled:cursor-not-allowed disabled:bg-surface disabled:opacity-70"
        onClick={() => { setSearch(''); setOpen((current) => !current); }}
      >
        <span className={selectedName ? 'truncate' : 'truncate text-muted'}>
          {selectedName ?? 'اختر المنتج'}
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-muted" aria-hidden />
      </button>
      {open ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 rounded-control border border-line bg-paper p-2 shadow-lg">
          <div className="relative">
            <Search className="pointer-events-none absolute inset-y-0 start-3 my-auto size-4 text-muted" aria-hidden />
            <Input
              type="search"
              autoFocus
              aria-label={`بحث عن ${label}`}
              placeholder="اسم المنتج أو الباركود"
              className="ps-9"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }}
            />
          </div>
          <ul id={`${id}-options`} role="listbox" className="scroll-thin mt-2 max-h-56 overflow-y-auto">
            {matches.map((product) => (
              <li key={product.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={String(product.id) === value}
                  className="flex w-full items-center gap-2 rounded-control px-3 py-2 text-start text-sm hover:bg-surface"
                  onClick={() => { onChange(String(product.id)); setOpen(false); setSearch(''); }}
                >
                  <Check className={`size-4 shrink-0 ${String(product.id) === value ? 'opacity-100' : 'opacity-0'}`} aria-hidden />
                  <span className="min-w-0 flex-1 truncate">{product.name}</span>
                  {product.quantity !== undefined ? (
                    <span className="shrink-0 text-xs text-muted">متاح {product.quantity}</span>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
          {!matches.length ? <p className="px-3 py-4 text-center text-sm text-muted">لا توجد منتجات مطابقة</p> : null}
        </div>
      ) : null}
    </div>
  );
}
