import type { Metadata } from 'next';

import { ProductStockView } from '@/features/products';

export const metadata: Metadata = { title: 'المنتجات والمخزون' };

export default function ProductsPage() { return <ProductStockView />; }
