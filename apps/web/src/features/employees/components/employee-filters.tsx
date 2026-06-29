"use client";

import { useEffect, useState } from "react";

import { Input } from "@/shared/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/shared/components/ui/select";
import { useDebounce } from "@/shared/hooks/use-debounce";
import { useAllBranches } from "@/features/branches/branches.hooks";
import { EMPLOYEE_STATUS_LABELS } from "@/features/employees/employees.labels";
import type { EmployeeListFilters, EmployeeStatus } from "@/features/employees/employees.types";

const ALL_BRANCHES = "all";
const ALL_STATUSES = "all";

type EmployeeFiltersProps = {
  filters: EmployeeListFilters;
  /** Merge a filter change into the URL state. Callers reset `page` as needed. */
  onChange: (updates: Partial<EmployeeListFilters>) => void;
};

/** Search + branch + status filter bar for the employee list. */
export function EmployeeFilters({ filters, onChange }: EmployeeFiltersProps) {
  const branchesQuery = useAllBranches();
  const completedBranches = (branchesQuery.data?.branches ?? []).filter(
    (branch) => branch.setupStatus === "completed"
  );

  const [searchInput, setSearchInput] = useState(filters.search ?? "");
  const debouncedSearch = useDebounce(searchInput, 300);

  useEffect(() => {
    setSearchInput(filters.search ?? "");
  }, [filters.search]);

  useEffect(() => {
    const current = filters.search ?? "";
    if (debouncedSearch === current) {
      return;
    }
    onChange({ search: debouncedSearch || undefined, page: 1 });
    // Intentionally only reacts to the debounced value; comparing against the
    // current search above guards against a feedback loop.
  }, [debouncedSearch]);

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <Input
        className="sm:max-w-xs"
        placeholder="ابحث بالاسم"
        value={searchInput}
        onChange={(event) => setSearchInput(event.target.value)}
      />

      <Select
        value={filters.branchId ? String(filters.branchId) : ALL_BRANCHES}
        onValueChange={(value) =>
          onChange({ branchId: value === ALL_BRANCHES ? undefined : Number(value), page: 1 })
        }
      >
        <SelectTrigger aria-label="الفرع" className="sm:w-48">
          <SelectValue placeholder="الفرع" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_BRANCHES}>كل الفروع</SelectItem>
          {completedBranches.map((branch) => (
            <SelectItem key={branch.id} value={String(branch.id)}>
              {branch.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      <Select
        value={filters.status ?? ALL_STATUSES}
        onValueChange={(value) =>
          onChange({
            status: value === ALL_STATUSES ? undefined : (value as EmployeeStatus),
            page: 1
          })
        }
      >
        <SelectTrigger aria-label="الحالة" className="sm:w-40">
          <SelectValue placeholder="الحالة" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL_STATUSES}>كل الحالات</SelectItem>
          <SelectItem value="active">{EMPLOYEE_STATUS_LABELS.active}</SelectItem>
          <SelectItem value="soft_deleted">{EMPLOYEE_STATUS_LABELS.soft_deleted}</SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
}
