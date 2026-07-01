import { AdminReportsDashboard } from "@/features/reports/components/admin-reports-dashboard";

export default function AdminReportsPage() {
  return (
    <main className="space-y-6 bg-[radial-gradient(circle_at_top_right,rgba(20,184,166,0.12),transparent_32%),linear-gradient(180deg,#f8fafc,#f1f5f9)] p-4 sm:p-6 lg:p-8">
      <div>
        <p className="text-sm text-muted-foreground">ملخصات شهرية وملفات PDF جاهزة للمراجعة</p>
        <h1 className="text-2xl font-bold">التقارير والتصدير</h1>
      </div>

      <AdminReportsDashboard />
    </main>
  );
}
