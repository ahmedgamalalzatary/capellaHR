import { FixedAssetsView } from '@/features/fixed-assets';
import { RequireErpAccount } from '@/features/auth';

export default function FixedAssetsPage() {
  return <RequireErpAccount role="admin"><FixedAssetsView /></RequireErpAccount>;
}
