import { Badge } from '@capella/ui';

import type { AdjustmentLock } from '../types';

/**
 * Why a payroll record can no longer be edited or deleted, shown in place of its
 * actions so nobody reaches for a button the server would refuse.
 */
export function LockBadge({ record }: { record: AdjustmentLock & { employeeDeletedAt: string | null } }) {
  if (record.lockReason === 'payroll_finalized') return <Badge variant="neutral">معتمد — مقفل</Badge>;
  return <Badge variant="neutral">{record.employeeDeletedAt === null ? 'موظف غير نشط' : 'موظف محذوف'}</Badge>;
}
