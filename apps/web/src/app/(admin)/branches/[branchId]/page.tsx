"use client";

import { useParams, useRouter } from "next/navigation";

import { BranchForm } from "@/features/branches/components/branch-form";
import { useBranch } from "@/features/branches/branches.hooks";

export default function EditBranchPage() {
  const router = useRouter();
  const params = useParams<{ branchId: string }>();
  const branchId = Number(params.branchId);
  const { data, isPending, isError } = useBranch(branchId);

  return (
    <main className="max-w-2xl space-y-6 p-8">
      <h1 className="text-2xl font-bold">تعديل الفرع</h1>
      {isPending ? (
        <p className="text-muted-foreground text-sm">جارٍ التحميل...</p>
      ) : isError ? (
        <p className="text-destructive text-sm">تعذّر تحميل الفرع</p>
      ) : (
        <BranchForm branch={data.branch} onSuccess={() => router.push("/branches")} />
      )}
    </main>
  );
}
