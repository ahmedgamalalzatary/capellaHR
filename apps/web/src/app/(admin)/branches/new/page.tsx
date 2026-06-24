"use client";

import { useRouter } from "next/navigation";

import { BranchForm } from "@/features/branches/components/branch-form";

export default function NewBranchPage() {
  const router = useRouter();

  return (
    <main className="max-w-2xl space-y-6 p-4 sm:p-6 lg:p-8">
      <h1 className="text-2xl font-bold">إضافة فرع</h1>
      <BranchForm onSuccess={() => router.push("/branches")} />
    </main>
  );
}
