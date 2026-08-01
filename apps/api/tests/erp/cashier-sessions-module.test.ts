import { describe, expect, it } from 'vitest';

import * as sales from '../../src/modules/erp/sales/index.js';

describe('ERP sales module', () => {
  it('publishes the sales composition root through its public boundary', () => {
    expect(Reflect.get(sales, 'createSalesModule')).toBeTypeOf('function');
  });
});
