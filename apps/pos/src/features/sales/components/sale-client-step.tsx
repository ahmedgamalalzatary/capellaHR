'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@capella/ui';

import { ClientPicker, type Client } from '@/features/clients';

import { StepTitle } from './sale-primitives';

/** Step 1: who the sale is for. */
export function SaleClientStep({
  branchId,
  client,
  selectClient,
}: {
  branchId?: number;
  client: Client | null;
  selectClient: (next: Client | null) => void;
}) {
  return (
    <Card className="shadow-card">
      <CardHeader><CardTitle><StepTitle step={1} label="العميل" /></CardTitle></CardHeader>
      <CardContent className="p-5">
        <ClientPicker selected={client} onSelect={selectClient} {...(branchId === undefined ? {} : { branchId })} />
      </CardContent>
    </Card>
  );
}
