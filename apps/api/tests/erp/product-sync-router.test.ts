import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createErpProductSyncRouter } from '../../src/modules/erp/product-sync/product-sync-router.js';
import type { ProductSyncService } from '../../src/modules/erp/product-sync/product-sync-service.js';

const activate = vi.fn(async () => ({ allGreen: true }));
const app = express();
app.use(express.json());
app.use((_request, response, next) => { response.locals.actor = { type: 'admin', accountId: 7 }; next(); });
app.use('/sync', createErpProductSyncRouter({ activate } as unknown as ProductSyncService));
beforeEach(() => activate.mockClear());
describe('product sync final confirmation', () => {
  it('passes the validated final choices to activation', async () => {
    await request(app).post('/sync/1/activation').send({ decisions: [
      { senderProductId: '5', decision: { action: 'link', receiverProductId: '9' } },
    ] }).expect(200);
    expect(activate).toHaveBeenCalledWith({ role: 'admin', accountId: 7 }, 1, {
      decisions: [{ senderProductId: 5, decision: { action: 'link', receiverProductId: 9 } }],
    });
  });
  it('rejects duplicate decisions for one product before activation', async () => {
    await request(app).post('/sync/1/activation').send({ decisions: [
      { senderProductId: 5, decision: { action: 'exclude', notSameAsProductId: null } },
      { senderProductId: 5, decision: { action: 'create', name: 'Other' } },
    ] }).expect(400);
    expect(activate).not.toHaveBeenCalled();
  });
});
