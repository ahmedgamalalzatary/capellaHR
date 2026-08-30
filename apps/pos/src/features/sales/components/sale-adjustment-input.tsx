'use client';

import { Input, Label } from '@capella/ui';

import { Select } from '@/components/form/select';

import { type AdjustmentKind } from './sale-primitives';

export function AdjustmentInput(props: {
  label: string;
  kind: AdjustmentKind;
  value: string;
  onKind: (kind: AdjustmentKind) => void;
  onValue: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{props.label}</Label>
      <div className="flex gap-2">
        <Select
          aria-label={`نوع ${props.label}`}
          className="w-auto shrink-0 px-2"
          value={props.kind}
          onChange={(event) => props.onKind(event.target.value as AdjustmentKind)}
        >
          <option value="percentage">نسبة %</option>
          <option value="fixed">مبلغ ثابت</option>
        </Select>
        <Input
          aria-label={`قيمة ${props.label}`}
          inputMode="decimal"
          className="text-start"
          value={props.value}
          onChange={(event) => props.onValue(event.target.value)}
        />
      </div>
    </div>
  );
}
