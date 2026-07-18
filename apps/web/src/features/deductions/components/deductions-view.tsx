'use client';

import { AdjustmentView } from '../../financial-adjustments/components/adjustment-view';
import {
  createDeduction,
  deleteDeduction,
  listDeductions,
  updateDeduction,
} from '../api/deductions-api';
import { deductionQueryKeys } from '../query-keys';

export function DeductionsView() {
  return (
    <AdjustmentView
      api={{
        list: listDeductions,
        create: createDeduction,
        update: updateDeduction,
        remove: deleteDeduction,
      }}
      queryKeys={deductionQueryKeys}
      labels={{
        addLabel: 'إضافة خصم',
        formTitleCreate: 'خصم جديد',
        formTitleEdit: 'تعديل الخصم',
        emptyTitle: 'لا توجد خصومات',
        emptyDescription: 'يمكن إضافة خصم يدوي للموظف عن الشهر الحالي أو شهر سابق غير معتمد.',
        loadErrorTitle: 'تعذر تحميل الخصومات',
        loadingText: 'جارٍ تحميل الخصومات…',
        totalNoun: 'خصم',
      }}
    />
  );
}
