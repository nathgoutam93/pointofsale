import { initContract } from '@ts-rest/core';
import { z } from 'zod';
const c = initContract();
const roleSchema = z.enum(['ADMIN', 'CASHIER']);
const paymentModeSchema = z.enum(['CASH', 'CARD', 'WALLET']);
const invoiceStatusSchema = z.enum(['DRAFT', 'SETTLED', 'PARTIALLY_SETTLED', 'CANCELLED']);
const stockTxnTypeSchema = z.enum(['OPENING', 'ADJUSTMENT_PLUS', 'ADJUSTMENT_MINUS', 'SALE', 'RETURN']);
const walletTxnTypeSchema = z.enum(['TOPUP', 'DEBIT_SALE', 'REFUND_RETURN', 'ADJUSTMENT']);
export const moneySchema = z.number().finite();
export const branchSchema = z.object({
    id: z.string().uuid(),
    name: z.string(),
    code: z.string()
});
export const customerSchema = z.object({
    id: z.string().uuid(),
    branchId: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    phone: z.string().nullable(),
    isWalkIn: z.boolean(),
    createdAt: z.string().datetime()
});
export const walletSchema = z.object({
    customerId: z.string().uuid(),
    branchId: z.string().uuid(),
    balance: moneySchema
});
export const walletTxnSchema = z.object({
    id: z.string().uuid(),
    walletAccountId: z.string().uuid(),
    type: walletTxnTypeSchema,
    amount: moneySchema,
    referenceType: z.string().nullable(),
    referenceId: z.string().nullable(),
    createdAt: z.string().datetime()
});
export const itemSchema = z.object({
    id: z.string().uuid(),
    code: z.string(),
    name: z.string(),
    category: z.string().nullable(),
    uom: z.string(),
    sellPrice: moneySchema,
    taxRate: z.number().min(0),
    isActive: z.boolean(),
    createdAt: z.string().datetime()
});
const saleLineInput = z.object({
    itemId: z.string().uuid(),
    qty: z.number().positive(),
    rate: moneySchema,
    discountAmount: moneySchema.default(0),
    taxRate: z.number().min(0)
});
const saleLineSchema = saleLineInput.extend({
    id: z.string().uuid(),
    taxableAmount: moneySchema,
    taxAmount: moneySchema,
    netAmount: moneySchema
});
const paymentSchema = z.object({
    id: z.string().uuid(),
    invoiceId: z.string().uuid(),
    mode: paymentModeSchema,
    amount: moneySchema,
    reference: z.string().nullable(),
    createdAt: z.string().datetime()
});
const saleInvoiceSchema = z.object({
    id: z.string().uuid(),
    branchId: z.string().uuid(),
    invoiceNo: z.string(),
    customerId: z.string().uuid(),
    subTotal: moneySchema,
    discountTotal: moneySchema,
    orderDiscountAmount: moneySchema.default(0),
    taxTotal: moneySchema,
    grandTotal: moneySchema,
    paidTotal: moneySchema,
    status: invoiceStatusSchema,
    createdBy: z.string().uuid(),
    createdAt: z.string().datetime()
});
const saleInvoiceWithLinesSchema = saleInvoiceSchema.extend({
    lines: z.array(saleLineSchema),
    payments: z.array(paymentSchema)
});
const stockLedgerSchema = z.object({
    id: z.string().uuid(),
    branchId: z.string().uuid(),
    itemId: z.string().uuid(),
    txnType: stockTxnTypeSchema,
    qtyIn: z.number().nonnegative(),
    qtyOut: z.number().nonnegative(),
    reason: z.string().nullable(),
    referenceType: z.string().nullable(),
    referenceId: z.string().nullable(),
    createdAt: z.string().datetime()
});
const receiptSchema = z.object({
    id: z.string().uuid(),
    receiptNo: z.string(),
    invoiceId: z.string().uuid(),
    amount: moneySchema,
    createdAt: z.string().datetime()
});
const returnSchema = z.object({
    id: z.string().uuid(),
    saleInvoiceId: z.string().uuid(),
    returnNo: z.string(),
    totalAmount: moneySchema,
    refundMode: paymentModeSchema,
    createdAt: z.string().datetime()
});
export const appContract = c.router({
    auth: {
        login: {
            method: 'POST',
            path: '/auth/login',
            body: z.object({ username: z.string(), password: z.string() }),
            responses: { 200: z.object({ token: z.string(), userId: z.string().uuid(), role: roleSchema, branchId: z.string().uuid() }) }
        },
        me: {
            method: 'GET',
            path: '/auth/me',
            responses: { 200: z.object({ userId: z.string().uuid(), role: roleSchema, branchId: z.string().uuid() }) }
        }
    },
    customers: {
        list: {
            method: 'GET',
            path: '/customers',
            query: z.object({ branchId: z.string().uuid() }),
            responses: { 200: z.array(customerSchema) }
        },
        create: {
            method: 'POST',
            path: '/customers',
            body: z.object({ branchId: z.string().uuid(), name: z.string(), phone: z.string().optional() }),
            responses: { 201: customerSchema }
        },
        getWalkIn: {
            method: 'GET',
            path: '/customers/walk-in/:branchId',
            responses: { 200: customerSchema }
        },
        getWallet: {
            method: 'GET',
            path: '/customers/:id/wallet',
            responses: { 200: walletSchema }
        },
        topupWallet: {
            method: 'POST',
            path: '/customers/:id/wallet/topup',
            body: z.object({ amount: moneySchema.positive(), reference: z.string().optional() }),
            responses: { 200: walletTxnSchema }
        }
    },
    items: {
        list: {
            method: 'GET',
            path: '/items',
            query: z.object({ activeOnly: z.coerce.boolean().optional() }),
            responses: { 200: z.array(itemSchema) }
        },
        create: {
            method: 'POST',
            path: '/items',
            body: z.object({ code: z.string(), name: z.string(), category: z.string().optional(), uom: z.string(), sellPrice: moneySchema.nonnegative(), taxRate: z.number().min(0) }),
            responses: { 201: itemSchema }
        },
        update: {
            method: 'PATCH',
            path: '/items/:id',
            body: z.object({ name: z.string().optional(), category: z.string().nullable().optional(), uom: z.string().optional(), sellPrice: moneySchema.nonnegative().optional(), taxRate: z.number().min(0).optional(), isActive: z.boolean().optional() }),
            responses: { 200: itemSchema }
        }
    },
    stock: {
        opening: {
            method: 'POST',
            path: '/stock/opening',
            body: z.object({ branchId: z.string().uuid(), itemId: z.string().uuid(), qty: z.number().positive(), reason: z.string().optional() }),
            responses: { 201: stockLedgerSchema }
        },
        adjustment: {
            method: 'POST',
            path: '/stock/adjustment',
            body: z.object({ branchId: z.string().uuid(), itemId: z.string().uuid(), qty: z.number().positive(), direction: z.enum(['IN', 'OUT']), reason: z.string() }),
            responses: { 201: stockLedgerSchema }
        },
        onHand: {
            method: 'GET',
            path: '/stock/on-hand',
            query: z.object({ branchId: z.string().uuid(), itemId: z.string().uuid().optional() }),
            responses: { 200: z.array(z.object({ itemId: z.string().uuid(), onHand: z.number() })) }
        },
        ledger: {
            method: 'GET',
            path: '/stock/ledger',
            query: z.object({ branchId: z.string().uuid(), itemId: z.string().uuid().optional() }),
            responses: { 200: z.array(stockLedgerSchema) }
        }
    },
    sales: {
        create: {
            method: 'POST',
            path: '/sales',
            body: z.object({
                branchId: z.string().uuid(),
                customerId: z.string().uuid(),
                lines: z.array(saleLineInput).min(1),
                orderDiscountAmount: moneySchema.default(0)
            }),
            responses: { 201: saleInvoiceWithLinesSchema }
        },
        settle: {
            method: 'POST',
            path: '/sales/:id/settle',
            body: z.object({ payments: z.array(z.object({ mode: paymentModeSchema, amount: moneySchema.positive(), reference: z.string().optional() })).min(1) }),
            responses: { 200: z.object({ invoice: saleInvoiceWithLinesSchema, receipt: receiptSchema }) }
        },
        list: {
            method: 'GET',
            path: '/sales',
            query: z.object({ branchId: z.string().uuid() }),
            responses: { 200: z.array(saleInvoiceSchema) }
        },
        getById: {
            method: 'GET',
            path: '/sales/:id',
            responses: { 200: saleInvoiceWithLinesSchema }
        },
        returns: {
            method: 'POST',
            path: '/sales/:id/return',
            body: z.object({ lines: z.array(z.object({ saleLineId: z.string().uuid(), qty: z.number().positive() })).min(1), refundMode: paymentModeSchema }),
            responses: { 201: returnSchema }
        }
    },
    receipts: {
        getById: {
            method: 'GET',
            path: '/receipts/:id',
            responses: { 200: receiptSchema }
        },
        getByInvoice: {
            method: 'GET',
            path: '/receipts/by-invoice/:invoiceId',
            responses: { 200: receiptSchema }
        }
    }
});
//# sourceMappingURL=index.js.map
