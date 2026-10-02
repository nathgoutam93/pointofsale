import { randomUUID } from 'crypto';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { AppModule } from '../src/app.module';

export const ADMIN = { username: 'admin', password: 'admin-test-password' };

export type ApiResponse<T = any> = { status: number; body: T };

/** The real app (guard, validation, service) on a random port, plus a direct DB client. */
export async function startApp() {
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false });
  await app.listen(0);
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
  const db = new PrismaClient();
  // Signing in picks up a register the user still has open, so start each file with none
  // left over from earlier files.
  await db.registerSession.updateMany({ where: { closedAt: null }, data: { closedAt: new Date(), closingBalance: 0 } });

  async function call<T = any>(method: string, path: string, token?: string | null, body?: unknown): Promise<ApiResponse<T>> {
    const res = await fetch(baseUrl + path, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const text = await res.text();
    let parsed: any = text;
    try {
      parsed = JSON.parse(text);
    } catch {
      // not JSON
    }
    return { status: res.status, body: parsed };
  }

  /** Like call, but fails the test unless the request succeeded. */
  async function ok<T = any>(method: string, path: string, token?: string | null, body?: unknown): Promise<T> {
    const res = await call<T>(method, path, token, body);
    if (res.status >= 300) throw new Error(`${method} ${path} -> ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async function login(username = ADMIN.username, password = ADMIN.password) {
    return (await ok<{ token: string }>('POST', '/auth/login', null, { username, password })).token;
  }

  /** A fresh branch with an open register (so each test file has its own data). */
  async function branchWithRegister(adminToken: string, openingBalance = 0) {
    const code = `T${randomUUID().slice(0, 8).toUpperCase()}`;
    const branch = await ok<{ id: string; code: string }>('POST', '/branches', adminToken, { name: `Test ${code}`, code });
    const opened = await ok<{ token: string; register: { id: string } }>('POST', '/registers/open', adminToken, {
      branchId: branch.id,
      openingBalance
    });
    const walkIn = await ok<{ id: string }>('GET', `/customers/walk-in/${branch.id}`, opened.token);
    return { branch, token: opened.token, registerId: opened.register.id, walkIn };
  }

  async function item(
    token: string,
    branchId: string,
    opts: { sellPrice?: number; costPrice?: number; taxRate?: number; taxMode?: 'INCLUSIVE' | 'EXCLUSIVE'; stock?: number; saleUoms?: unknown[] } = {}
  ) {
    const created = await ok<{ id: string; code: string }>('POST', '/items', token, {
      code: `I${randomUUID().slice(0, 10)}`,
      name: `Item ${randomUUID().slice(0, 6)}`,
      uom: 'PCS',
      sellPrice: opts.sellPrice ?? 100,
      costPrice: opts.costPrice,
      taxRate: opts.taxRate ?? 0,
      taxMode: opts.taxMode ?? 'EXCLUSIVE',
      saleUoms: opts.saleUoms
    });
    if ((opts.stock ?? 100) > 0) {
      await ok('POST', '/stock/opening', token, { branchId, itemId: created.id, qty: opts.stock ?? 100 });
    }
    return created;
  }

  async function onHand(token: string, branchId: string, itemId: string) {
    const rows = await ok<Array<{ onHand: number }>>('GET', `/stock/on-hand?branchId=${branchId}&itemId=${itemId}`, token);
    return Number(rows[0]?.onHand ?? 0);
  }

  async function close() {
    await db.$disconnect();
    await app.close();
  }

  return { app, baseUrl, db, call, ok, login, branchWithRegister, item, onHand, close };
}

export type TestApp = Awaited<ReturnType<typeof startApp>>;

/** A sale line for `item` at its list price. */
export const line = (itemId: string, o: Record<string, unknown> = {}) => ({
  itemId,
  qty: 1,
  rate: 100,
  taxRate: 0,
  taxMode: 'EXCLUSIVE',
  ...o
});

export const checkoutBody = (branchId: string, customerId: string, lines: unknown[], payments: unknown[], extra: Record<string, unknown> = {}) => ({
  branchId,
  customerId,
  lines,
  payments,
  idempotencyKey: randomUUID(),
  ...extra
});
