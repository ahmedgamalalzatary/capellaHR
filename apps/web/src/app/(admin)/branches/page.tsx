import Link from "next/link";

import { Button } from "@/shared/components/ui/button";
import { BranchList } from "@/features/branches/components/branch-list";

export default function BranchesPage() {
  return (
    <main className="space-y-6 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">الفروع</h1>
        <Button asChild>
          <Link href="/branches/new">إضافة فرع</Link>
        </Button>
      </div>
      <BranchList />
    </main>
  );
}
