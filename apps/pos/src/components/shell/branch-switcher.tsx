'use client';

import { Building2 } from 'lucide-react';

import { useAdminBranch } from '@/hooks/use-admin-branch';
import { useBranchOptions } from '@/hooks/use-branch-options';

/**
 * The admin's one branch control, in the top bar. Every POS page reads the same shared branch,
 * so changing it here moves the page underneath at once.
 */
export function BranchSwitcher() {
  const { branchId, setBranchId, isAdmin } = useAdminBranch();
  const { query, options } = useBranchOptions({ enabled: isAdmin });
  if (!isAdmin) return null;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <Building2 className="size-4 shrink-0 text-muted" aria-hidden />
      <label htmlFor="topbar-branch" className="sr-only">الفرع الحالي</label>
      <select
        id="topbar-branch"
        value={branchId === undefined ? '' : String(branchId)}
        disabled={query.isPending || query.isError}
        onChange={(event) => setBranchId(event.target.value ? Number(event.target.value) : undefined)}
        className="h-(--control-h-sm) max-w-[11rem] min-w-0 truncate rounded-control border border-line bg-paper ps-2 pe-7 text-sm font-medium text-ink sm:max-w-[16rem]"
      >
        <option value="">{query.isError ? 'تعذر تحميل الفروع' : 'اختر فرعًا'}</option>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
      {query.isError ? (
        <button type="button" className="text-[12px] text-danger underline" onClick={() => void query.refetch()}>
          إعادة المحاولة
        </button>
      ) : null}
    </div>
  );
}
