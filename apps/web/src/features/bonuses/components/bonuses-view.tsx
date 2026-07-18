'use client';

import { AdjustmentView } from '../../financial-adjustments/components/adjustment-view';
import { createBonus, deleteBonus, listBonuses, updateBonus } from '../api/bonuses-api';
import { bonusQueryKeys } from '../query-keys';

export function BonusesView() {
  return (
    <AdjustmentView
      api={{
        list: listBonuses,
        create: createBonus,
        update: updateBonus,
        remove: deleteBonus,
      }}
      queryKeys={bonusQueryKeys}
      labels={{
        addLabel: 'إضافة مكافأة',
        formTitleCreate: 'مكافأة جديدة',
        formTitleEdit: 'تعديل المكافأة',
        emptyTitle: 'لا توجد مكافآت',
        emptyDescription: 'يمكن إضافة مكافأة للموظف عن الشهر الحالي أو شهر سابق غير معتمد.',
        loadErrorTitle: 'تعذر تحميل المكافآت',
        loadingText: 'جارٍ تحميل المكافآت…',
        totalNoun: 'مكافأة',
      }}
    />
  );
}
