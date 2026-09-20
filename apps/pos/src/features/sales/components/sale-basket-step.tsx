'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import type { Dispatch, SetStateAction } from 'react';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  Input,
} from '@capella/ui';

import { ServicePicker, type ServiceListItem } from '@/features/catalog';
import { ProductPicker, type ProductSaleItem } from '@/features/products';
import type { AssignableEmployee } from '@/features/employee-assignment';

import { LineEmployeeSelect } from './line-employee-select';
import {
  appendServiceLine,
  decrementLine,
  incrementLine,
  removeLine,
  type Line,
} from './sale-primitives';
import { createUuid } from '@/lib/uuid';

export function SaleBasketStep({
  branchId,
  employee,
  lines,
  setLines,
  hasServices,
  hasProducts,
  onServicesAvailability,
  onProductsAvailability,
}: {
  branchId?: number;
  employee: AssignableEmployee | null;
  lines: Line[];
  setLines: Dispatch<SetStateAction<Line[]>>;
  hasServices: boolean;
  hasProducts: boolean;
  onServicesAvailability: (available: boolean) => void;
  onProductsAvailability: (available: boolean) => void;
}) {
  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle>{hasServices && hasProducts ? 'الخدمات والمنتجات' : hasServices ? 'الخدمات' : 'المنتجات'}</CardTitle></CardHeader>
      <CardContent className="space-y-5 p-5">
        <div className={hasServices && hasProducts ? 'grid gap-4 md:grid-cols-2' : 'grid gap-4'}>
          {!hasServices && !hasProducts ? <EmptyState title="لا توجد خدمات أو منتجات متاحة" /> : null}
          {hasServices ? (
          // Every tap adds one more unit as its own line, so each unit of the same
          // service can be performed — and commissioned — by a different employee.
          <ServicePicker {...(branchId === undefined ? {} : { branchId })} onSelect={(service) => setLines((current) => appendServiceLine(current, service, employee, createUuid))} onAvailabilityChange={onServicesAvailability} />
          ) : null}
          {hasProducts ? <ProductPicker {...(branchId === undefined ? {} : { branchId })} onSelect={(product) => setLines((current) => {
            const found = current.find(({ service: item, itemType }) => itemType === 'product' && item.id === product.id);
            return found
              ? incrementLine(current, found.lineId).map((line) => line.lineId === found.lineId
                ? { ...line, quantity: Math.min(line.quantity, product.quantityAvailable) }
                : line)
              : [...current, {
                  lineId: createUuid(),
                  service: product,
                  quantity: 1,
                  unitPrice: product.price,
                  itemType: 'product',
                  employee: null,
                }];
          })} onAvailabilityChange={onProductsAvailability} /> : null}
        </div>

        {lines.length > 0 ? (
          <ul className="space-y-2 border-t border-line/70 pt-4">
            {lines.map((line) => (
              <li
                key={line.lineId}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 rounded-control border border-line bg-surface/50 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,12rem)_auto]"
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{line.service.name}</span>
                  {line.itemType !== 'product' && line.service.price === null ? (
                    <Input
                      aria-label={`سعر ${line.service.name}`}
                      inputMode="decimal"
                      className="mt-1 h-9 w-36 text-start"
                      placeholder="سعر الوحدة"
                      value={line.unitPrice}
                      onChange={(event) => setLines((current) => current.map((item) => (
                        item.lineId === line.lineId
                          ? { ...item, unitPrice: event.target.value }
                          : item
                      )))}
                    />
                  ) : (
                    <span className="tabular text-[13px] text-muted">{line.service.price} ج.م</span>
                  )}
                </span>
                {line.itemType !== 'product' ? (
                  <LineEmployeeSelect
                    line={line}
                    {...(branchId === undefined ? {} : { branchId })}
                    onSelect={(performer) => setLines((current) => current.map((item) => (
                      item.lineId === line.lineId
                        ? { ...item, employee: performer }
                        : item
                    )))}
                  />
                ) : null}
                {/* The most-tapped control in the app: kept at a 44px touch target. */}
                <span className="flex items-center gap-1 rounded-control border border-line bg-paper p-0.5">
                  <Button variant="ghost" className="size-11 px-0" aria-label={`تقليل ${line.service.name}`} onClick={() => setLines((current) => (line.quantity > 1 ? decrementLine(current, line.lineId) : removeLine(current, line.lineId)))}><Minus className="size-4" aria-hidden /></Button>
                  <span className="tabular w-8 text-center text-sm font-semibold">{line.quantity}</span>
                  <Button variant="ghost" className="size-11 px-0" disabled={line.itemType === 'product' && line.quantity >= (line.service as ProductSaleItem).quantityAvailable} aria-label={`زيادة ${line.service.name}`} onClick={() => setLines((current) => (
                    line.itemType === 'product'
                      ? incrementLine(current, line.lineId)
                      : appendServiceLine(current, line.service as ServiceListItem, line.employee ?? null, createUuid)
                  ))}><Plus className="size-4" aria-hidden /></Button>
                  <Button variant="ghost" className="size-11 px-0" aria-label={`حذف ${line.service.name}`} onClick={() => setLines((current) => removeLine(current, line.lineId))}><Trash2 className="size-4" aria-hidden /></Button>
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </CardContent>
    </Card>
  );
}
