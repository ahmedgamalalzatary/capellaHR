import { LoadingState } from '@/components/feedback/loading-state';

export default function ProtectedRouteLoading() {
  return (
    <div className="mx-auto max-w-xl rounded-card border border-line bg-paper shadow-card">
      <LoadingState label="جارٍ تحميل صفحة نقطة البيع…" className="p-8" />
    </div>
  );
}
