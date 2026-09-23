import {
  accounts,
  branchCashierRoster,
  branches,
  cashierSessions,
  clients,
  employees,
  erpCategories,
  erpProducts,
  erpProductStocks,
  erpServiceCommissionOverrides,
  erpServices,
} from '@capella/database/schema';
import { eq } from 'drizzle-orm';

import type { CompleteSaleOperation } from '../../src/modules/erp/sales/sale-service.js';
import { createMysqlIntegrationDatabase } from '../mysql-integration-database.js';

export const database = createMysqlIntegrationDatabase();

let sequence = 0;
export const fixture = async () => {
  sequence += 1;
  const uniqueNumber = Math.floor(Math.random() * 80_000_000) + 10_000_000;
  const employeeCode = 1_500_000_000 + uniqueNumber;
  const marker = `erp9-${process.pid}-${Date.now()}-${uniqueNumber}-${sequence}`;
  const clientPhone = `012${uniqueNumber}`;
  const at = new Date('2026-08-03T11:35:00.000Z');
  const branchId = Number((await database.insert(branches).values({
    name: marker,
    nameNormalized: marker,
    location: 'Cairo',
    latitude: 30,
    longitude: 31,
    gpsAccuracyMeters: 5,
    attendanceRadiusMeters: 100,
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const employeeId = Number((await database.insert(employees).values({
    employeeCode,
    fullName: `Employee ${marker}`,
    personalPhone: `010${uniqueNumber}`,
    whatsappPhone: `011${uniqueNumber}`,
    pinHash: 'unused',
    age: 30,
    address: 'Cairo',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const sellerEmployeeId = Number((await database.insert(employees).values({
    employeeCode: employeeCode + 1,
    fullName: `Seller ${marker}`,
    personalPhone: `015${uniqueNumber}`,
    whatsappPhone: `015${uniqueNumber}`,
    pinHash: 'unused',
    age: 30,
    address: 'Cairo',
    branchId,
    shiftDurationMinutes: 480,
    monthlyBaseSalary: '5000.00',
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  await database.insert(branchCashierRoster).values({ branchId, employeeId: sellerEmployeeId, createdAt: at });
  const accountId = Number((await database.insert(accounts).values({
    username: marker,
    passwordHash: 'unused',
    role: 'cashier',
    branchId,
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const adminAccountId = (await database.select({ id: accounts.id }).from(accounts)
    .where(eq(accounts.role, 'admin')).limit(1))[0]!.id;
  const clientId = Number((await database.insert(clients).values({
    branchId,
    fullName: `Client ${marker}`,
    phone: clientPhone,
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const categoryId = Number((await database.insert(erpCategories).values({
    branchId,
    type: 'service',
    name: `Category ${marker}`,
    nameNormalized: `category-${marker}`,
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const serviceId = Number((await database.insert(erpServices).values({
    branchId,
    categoryId,
    name: `Service ${marker}`,
    nameNormalized: `service-${marker}`,
    price: '200.00',
    commissionPercent: '10.00',
    createdAt: at,
    updatedAt: at,
  }))[0].insertId);
  const productId = Number((await database.insert(erpProducts).values({
    branchId, name: `Product ${marker}`, nameNormalized: `product-${marker}`,
    sellingPrice: '50.00', lastPurchaseCost: '30.00', lowStockThreshold: 1,
    createdAt: at, updatedAt: at,
  }))[0].insertId);
  await database.insert(erpProductStocks).values({ productId, branchId, quantity: 2, updatedAt: at });
  await database.insert(erpServiceCommissionOverrides).values({
    serviceId,
    employeeId,
    commissionPercent: '15.00',
    createdAt: at,
    updatedAt: at,
  });
  const cashierSessionId = Number((await database.insert(cashierSessions).values({
    branchId,
    openedByAccountId: accountId,
    openedAt: at,
  }))[0].insertId);
  return {
    marker, clientPhone, at, branchId, employeeId, employeeCode, sellerEmployeeId,
    accountId, adminAccountId,
    clientId, serviceId, productId, cashierSessionId,
  };
};

export const operation = (data: Awaited<ReturnType<typeof fixture>>, key: string): CompleteSaleOperation => ({
  input: {
    branchId: data.branchId,
    clientId: data.clientId,
    sellerEmployeeId: data.sellerEmployeeId,
    cashierSessionId: data.cashierSessionId,
    idempotencyKey: key,
    lines: [{
      itemType: 'service' as const,
      serviceId: data.serviceId,
      quantity: 1,
      unitPrice: '200.00',
      employeeId: data.employeeId,
    }],
    discount: { kind: 'percentage' as const, value: '10.00' },
    tax: { kind: 'fixed' as const, value: '5.00' },
    payments: [{ method: 'cash' as const, amount: '185.00' }],
  },
  actingAccountId: data.accountId,
  actingAccountRole: 'cashier' as const,
  invoiceNumber: `INV-2026.08.03-14.35-${data.branchId}`,
  soldAt: data.at,
  assertEmployees: async () => [{
    id: data.employeeId,
    employeeCode: data.employeeCode,
    fullName: `Employee ${data.marker}`,
    branchId: data.branchId,
  }],
});

