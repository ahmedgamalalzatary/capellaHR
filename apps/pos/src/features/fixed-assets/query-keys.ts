import type { ListFixedAssetParams } from './api/fixed-assets-api';
export const fixedAssetQueryKeys = { all: ['fixed-assets'] as const, list: (params: ListFixedAssetParams) => ['fixed-assets', 'list', params] as const };
