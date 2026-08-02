import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from '../../src/app.js';
import type { AuthService } from '../../src/modules/auth/index.js';
import * as catalog from '../../src/modules/erp/catalog/index.js';
import type { CategoryService, ServiceCatalogService } from '../../src/modules/erp/index.js';

describe('ERP catalog module', () => {
  it('publishes the catalog composition root through its public boundary', () => {
    expect(Reflect.get(catalog, 'createErpCatalogModule')).toBeTypeOf('function');
  });
});

/**
 * The composition root authenticates before ERP routers run, so an unauthenticated
 * request must be rejected by auth rather than reaching the catalog service.
 */
const authService = {
  authenticate: vi.fn(async () => null),
} as unknown as AuthService;

const app = () => createApp({
  authService,
  erpCategoryService: {} as CategoryService,
  erpServiceCatalogService: {} as ServiceCatalogService,
});

describe('ERP catalog routing', () => {
  it('mounts the catalog endpoints behind authentication', async () => {
    for (const path of ['/api/v1/erp/categories', '/api/v1/erp/services']) {
      const response = await request(app()).get(path);

      expect(response.status).toBe(401);
    }
  });

  it('does not mount the catalog when its services are absent', async () => {
    const response = await request(createApp({ authService })).get('/api/v1/erp/categories');

    expect(response.status).toBe(404);
  });
});
