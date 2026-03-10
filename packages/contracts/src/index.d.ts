import { z } from 'zod';
export declare const moneySchema: z.ZodNumber;
export declare const branchSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    code: string;
    name: string;
}, {
    id: string;
    code: string;
    name: string;
}>;
export declare const customerSchema: z.ZodObject<{
    id: z.ZodString;
    branchId: z.ZodString;
    code: z.ZodString;
    name: z.ZodString;
    phone: z.ZodNullable<z.ZodString>;
    isWalkIn: z.ZodBoolean;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    code: string;
    name: string;
    branchId: string;
    phone: string | null;
    isWalkIn: boolean;
    createdAt: string;
}, {
    id: string;
    code: string;
    name: string;
    branchId: string;
    phone: string | null;
    isWalkIn: boolean;
    createdAt: string;
}>;
export declare const walletSchema: z.ZodObject<{
    customerId: z.ZodString;
    branchId: z.ZodString;
    balance: z.ZodNumber;
}, "strip", z.ZodTypeAny, {
    branchId: string;
    customerId: string;
    balance: number;
}, {
    branchId: string;
    customerId: string;
    balance: number;
}>;
export declare const walletTxnSchema: z.ZodObject<{
    id: z.ZodString;
    walletAccountId: z.ZodString;
    type: z.ZodEnum<["TOPUP", "DEBIT_SALE", "REFUND_RETURN", "ADJUSTMENT"]>;
    amount: z.ZodNumber;
    referenceType: z.ZodNullable<z.ZodString>;
    referenceId: z.ZodNullable<z.ZodString>;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    type: "TOPUP" | "DEBIT_SALE" | "REFUND_RETURN" | "ADJUSTMENT";
    createdAt: string;
    walletAccountId: string;
    amount: number;
    referenceType: string | null;
    referenceId: string | null;
}, {
    id: string;
    type: "TOPUP" | "DEBIT_SALE" | "REFUND_RETURN" | "ADJUSTMENT";
    createdAt: string;
    walletAccountId: string;
    amount: number;
    referenceType: string | null;
    referenceId: string | null;
}>;
export declare const itemSchema: z.ZodObject<{
    id: z.ZodString;
    code: z.ZodString;
    name: z.ZodString;
    category: z.ZodNullable<z.ZodString>;
    uom: z.ZodString;
    sellPrice: z.ZodNumber;
    taxRate: z.ZodNumber;
    isActive: z.ZodBoolean;
    createdAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    id: string;
    code: string;
    name: string;
    createdAt: string;
    category: string | null;
    uom: string;
    sellPrice: number;
    taxRate: number;
    isActive: boolean;
}, {
    id: string;
    code: string;
    name: string;
    createdAt: string;
    category: string | null;
    uom: string;
    sellPrice: number;
    taxRate: number;
    isActive: boolean;
}>;
export declare const appContract: {
    auth: {
        login: {
            body: z.ZodObject<{
                username: z.ZodString;
                password: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                username: string;
                password: string;
            }, {
                username: string;
                password: string;
            }>;
            method: "POST";
            path: "/auth/login";
            responses: {
                200: z.ZodObject<{
                    token: z.ZodString;
                    userId: z.ZodString;
                    role: z.ZodEnum<["ADMIN", "CASHIER"]>;
                    branchId: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    role: "ADMIN" | "CASHIER";
                    branchId: string;
                    token: string;
                    userId: string;
                }, {
                    role: "ADMIN" | "CASHIER";
                    branchId: string;
                    token: string;
                    userId: string;
                }>;
            };
        };
        me: {
            method: "GET";
            path: "/auth/me";
            responses: {
                200: z.ZodObject<{
                    userId: z.ZodString;
                    role: z.ZodEnum<["ADMIN", "CASHIER"]>;
                    branchId: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    role: "ADMIN" | "CASHIER";
                    branchId: string;
                    userId: string;
                }, {
                    role: "ADMIN" | "CASHIER";
                    branchId: string;
                    userId: string;
                }>;
            };
        };
    };
    customers: {
        list: {
            query: z.ZodObject<{
                branchId: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                branchId: string;
            }, {
                branchId: string;
            }>;
            method: "GET";
            path: "/customers";
            responses: {
                200: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    code: z.ZodString;
                    name: z.ZodString;
                    phone: z.ZodNullable<z.ZodString>;
                    isWalkIn: z.ZodBoolean;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    code: string;
                    name: string;
                    branchId: string;
                    phone: string | null;
                    isWalkIn: boolean;
                    createdAt: string;
                }, {
                    id: string;
                    code: string;
                    name: string;
                    branchId: string;
                    phone: string | null;
                    isWalkIn: boolean;
                    createdAt: string;
                }>, "many">;
            };
        };
        create: {
            body: z.ZodObject<{
                branchId: z.ZodString;
                name: z.ZodString;
                phone: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                name: string;
                branchId: string;
                phone?: string | undefined;
            }, {
                name: string;
                branchId: string;
                phone?: string | undefined;
            }>;
            method: "POST";
            path: "/customers";
            responses: {
                201: z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    code: z.ZodString;
                    name: z.ZodString;
                    phone: z.ZodNullable<z.ZodString>;
                    isWalkIn: z.ZodBoolean;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    code: string;
                    name: string;
                    branchId: string;
                    phone: string | null;
                    isWalkIn: boolean;
                    createdAt: string;
                }, {
                    id: string;
                    code: string;
                    name: string;
                    branchId: string;
                    phone: string | null;
                    isWalkIn: boolean;
                    createdAt: string;
                }>;
            };
        };
        getWalkIn: {
            method: "GET";
            path: "/customers/walk-in/:branchId";
            responses: {
                200: z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    code: z.ZodString;
                    name: z.ZodString;
                    phone: z.ZodNullable<z.ZodString>;
                    isWalkIn: z.ZodBoolean;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    code: string;
                    name: string;
                    branchId: string;
                    phone: string | null;
                    isWalkIn: boolean;
                    createdAt: string;
                }, {
                    id: string;
                    code: string;
                    name: string;
                    branchId: string;
                    phone: string | null;
                    isWalkIn: boolean;
                    createdAt: string;
                }>;
            };
        };
        getWallet: {
            method: "GET";
            path: "/customers/:id/wallet";
            responses: {
                200: z.ZodObject<{
                    customerId: z.ZodString;
                    branchId: z.ZodString;
                    balance: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    branchId: string;
                    customerId: string;
                    balance: number;
                }, {
                    branchId: string;
                    customerId: string;
                    balance: number;
                }>;
            };
        };
        topupWallet: {
            body: z.ZodObject<{
                amount: z.ZodNumber;
                reference: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                amount: number;
                reference?: string | undefined;
            }, {
                amount: number;
                reference?: string | undefined;
            }>;
            method: "POST";
            path: "/customers/:id/wallet/topup";
            responses: {
                200: z.ZodObject<{
                    id: z.ZodString;
                    walletAccountId: z.ZodString;
                    type: z.ZodEnum<["TOPUP", "DEBIT_SALE", "REFUND_RETURN", "ADJUSTMENT"]>;
                    amount: z.ZodNumber;
                    referenceType: z.ZodNullable<z.ZodString>;
                    referenceId: z.ZodNullable<z.ZodString>;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    type: "TOPUP" | "DEBIT_SALE" | "REFUND_RETURN" | "ADJUSTMENT";
                    createdAt: string;
                    walletAccountId: string;
                    amount: number;
                    referenceType: string | null;
                    referenceId: string | null;
                }, {
                    id: string;
                    type: "TOPUP" | "DEBIT_SALE" | "REFUND_RETURN" | "ADJUSTMENT";
                    createdAt: string;
                    walletAccountId: string;
                    amount: number;
                    referenceType: string | null;
                    referenceId: string | null;
                }>;
            };
        };
    };
    items: {
        list: {
            query: z.ZodObject<{
                activeOnly: z.ZodOptional<z.ZodBoolean>;
            }, "strip", z.ZodTypeAny, {
                activeOnly?: boolean | undefined;
            }, {
                activeOnly?: boolean | undefined;
            }>;
            method: "GET";
            path: "/items";
            responses: {
                200: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    code: z.ZodString;
                    name: z.ZodString;
                    category: z.ZodNullable<z.ZodString>;
                    uom: z.ZodString;
                    sellPrice: z.ZodNumber;
                    taxRate: z.ZodNumber;
                    isActive: z.ZodBoolean;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    code: string;
                    name: string;
                    createdAt: string;
                    category: string | null;
                    uom: string;
                    sellPrice: number;
                    taxRate: number;
                    isActive: boolean;
                }, {
                    id: string;
                    code: string;
                    name: string;
                    createdAt: string;
                    category: string | null;
                    uom: string;
                    sellPrice: number;
                    taxRate: number;
                    isActive: boolean;
                }>, "many">;
            };
        };
        create: {
            body: z.ZodObject<{
                code: z.ZodString;
                name: z.ZodString;
                category: z.ZodOptional<z.ZodString>;
                uom: z.ZodString;
                sellPrice: z.ZodNumber;
                taxRate: z.ZodNumber;
            }, "strip", z.ZodTypeAny, {
                code: string;
                name: string;
                uom: string;
                sellPrice: number;
                taxRate: number;
                category?: string | undefined;
            }, {
                code: string;
                name: string;
                uom: string;
                sellPrice: number;
                taxRate: number;
                category?: string | undefined;
            }>;
            method: "POST";
            path: "/items";
            responses: {
                201: z.ZodObject<{
                    id: z.ZodString;
                    code: z.ZodString;
                    name: z.ZodString;
                    category: z.ZodNullable<z.ZodString>;
                    uom: z.ZodString;
                    sellPrice: z.ZodNumber;
                    taxRate: z.ZodNumber;
                    isActive: z.ZodBoolean;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    code: string;
                    name: string;
                    createdAt: string;
                    category: string | null;
                    uom: string;
                    sellPrice: number;
                    taxRate: number;
                    isActive: boolean;
                }, {
                    id: string;
                    code: string;
                    name: string;
                    createdAt: string;
                    category: string | null;
                    uom: string;
                    sellPrice: number;
                    taxRate: number;
                    isActive: boolean;
                }>;
            };
        };
        update: {
            body: z.ZodObject<{
                name: z.ZodOptional<z.ZodString>;
                category: z.ZodOptional<z.ZodNullable<z.ZodString>>;
                uom: z.ZodOptional<z.ZodString>;
                sellPrice: z.ZodOptional<z.ZodNumber>;
                taxRate: z.ZodOptional<z.ZodNumber>;
                isActive: z.ZodOptional<z.ZodBoolean>;
            }, "strip", z.ZodTypeAny, {
                name?: string | undefined;
                category?: string | null | undefined;
                uom?: string | undefined;
                sellPrice?: number | undefined;
                taxRate?: number | undefined;
                isActive?: boolean | undefined;
            }, {
                name?: string | undefined;
                category?: string | null | undefined;
                uom?: string | undefined;
                sellPrice?: number | undefined;
                taxRate?: number | undefined;
                isActive?: boolean | undefined;
            }>;
            method: "PATCH";
            path: "/items/:id";
            responses: {
                200: z.ZodObject<{
                    id: z.ZodString;
                    code: z.ZodString;
                    name: z.ZodString;
                    category: z.ZodNullable<z.ZodString>;
                    uom: z.ZodString;
                    sellPrice: z.ZodNumber;
                    taxRate: z.ZodNumber;
                    isActive: z.ZodBoolean;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    code: string;
                    name: string;
                    createdAt: string;
                    category: string | null;
                    uom: string;
                    sellPrice: number;
                    taxRate: number;
                    isActive: boolean;
                }, {
                    id: string;
                    code: string;
                    name: string;
                    createdAt: string;
                    category: string | null;
                    uom: string;
                    sellPrice: number;
                    taxRate: number;
                    isActive: boolean;
                }>;
            };
        };
    };
    stock: {
        opening: {
            body: z.ZodObject<{
                branchId: z.ZodString;
                itemId: z.ZodString;
                qty: z.ZodNumber;
                reason: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                branchId: string;
                itemId: string;
                qty: number;
                reason?: string | undefined;
            }, {
                branchId: string;
                itemId: string;
                qty: number;
                reason?: string | undefined;
            }>;
            method: "POST";
            path: "/stock/opening";
            responses: {
                201: z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    itemId: z.ZodString;
                    txnType: z.ZodEnum<["OPENING", "ADJUSTMENT_PLUS", "ADJUSTMENT_MINUS", "SALE", "RETURN"]>;
                    qtyIn: z.ZodNumber;
                    qtyOut: z.ZodNumber;
                    reason: z.ZodNullable<z.ZodString>;
                    referenceType: z.ZodNullable<z.ZodString>;
                    referenceId: z.ZodNullable<z.ZodString>;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    branchId: string;
                    createdAt: string;
                    referenceType: string | null;
                    referenceId: string | null;
                    itemId: string;
                    txnType: "OPENING" | "ADJUSTMENT_PLUS" | "ADJUSTMENT_MINUS" | "SALE" | "RETURN";
                    qtyIn: number;
                    qtyOut: number;
                    reason: string | null;
                }, {
                    id: string;
                    branchId: string;
                    createdAt: string;
                    referenceType: string | null;
                    referenceId: string | null;
                    itemId: string;
                    txnType: "OPENING" | "ADJUSTMENT_PLUS" | "ADJUSTMENT_MINUS" | "SALE" | "RETURN";
                    qtyIn: number;
                    qtyOut: number;
                    reason: string | null;
                }>;
            };
        };
        adjustment: {
            body: z.ZodObject<{
                branchId: z.ZodString;
                itemId: z.ZodString;
                qty: z.ZodNumber;
                direction: z.ZodEnum<["IN", "OUT"]>;
                reason: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                branchId: string;
                itemId: string;
                qty: number;
                reason: string;
                direction: "IN" | "OUT";
            }, {
                branchId: string;
                itemId: string;
                qty: number;
                reason: string;
                direction: "IN" | "OUT";
            }>;
            method: "POST";
            path: "/stock/adjustment";
            responses: {
                201: z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    itemId: z.ZodString;
                    txnType: z.ZodEnum<["OPENING", "ADJUSTMENT_PLUS", "ADJUSTMENT_MINUS", "SALE", "RETURN"]>;
                    qtyIn: z.ZodNumber;
                    qtyOut: z.ZodNumber;
                    reason: z.ZodNullable<z.ZodString>;
                    referenceType: z.ZodNullable<z.ZodString>;
                    referenceId: z.ZodNullable<z.ZodString>;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    branchId: string;
                    createdAt: string;
                    referenceType: string | null;
                    referenceId: string | null;
                    itemId: string;
                    txnType: "OPENING" | "ADJUSTMENT_PLUS" | "ADJUSTMENT_MINUS" | "SALE" | "RETURN";
                    qtyIn: number;
                    qtyOut: number;
                    reason: string | null;
                }, {
                    id: string;
                    branchId: string;
                    createdAt: string;
                    referenceType: string | null;
                    referenceId: string | null;
                    itemId: string;
                    txnType: "OPENING" | "ADJUSTMENT_PLUS" | "ADJUSTMENT_MINUS" | "SALE" | "RETURN";
                    qtyIn: number;
                    qtyOut: number;
                    reason: string | null;
                }>;
            };
        };
        onHand: {
            query: z.ZodObject<{
                branchId: z.ZodString;
                itemId: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                branchId: string;
                itemId?: string | undefined;
            }, {
                branchId: string;
                itemId?: string | undefined;
            }>;
            method: "GET";
            path: "/stock/on-hand";
            responses: {
                200: z.ZodArray<z.ZodObject<{
                    itemId: z.ZodString;
                    onHand: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    itemId: string;
                    onHand: number;
                }, {
                    itemId: string;
                    onHand: number;
                }>, "many">;
            };
        };
        ledger: {
            query: z.ZodObject<{
                branchId: z.ZodString;
                itemId: z.ZodOptional<z.ZodString>;
            }, "strip", z.ZodTypeAny, {
                branchId: string;
                itemId?: string | undefined;
            }, {
                branchId: string;
                itemId?: string | undefined;
            }>;
            method: "GET";
            path: "/stock/ledger";
            responses: {
                200: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    itemId: z.ZodString;
                    txnType: z.ZodEnum<["OPENING", "ADJUSTMENT_PLUS", "ADJUSTMENT_MINUS", "SALE", "RETURN"]>;
                    qtyIn: z.ZodNumber;
                    qtyOut: z.ZodNumber;
                    reason: z.ZodNullable<z.ZodString>;
                    referenceType: z.ZodNullable<z.ZodString>;
                    referenceId: z.ZodNullable<z.ZodString>;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    branchId: string;
                    createdAt: string;
                    referenceType: string | null;
                    referenceId: string | null;
                    itemId: string;
                    txnType: "OPENING" | "ADJUSTMENT_PLUS" | "ADJUSTMENT_MINUS" | "SALE" | "RETURN";
                    qtyIn: number;
                    qtyOut: number;
                    reason: string | null;
                }, {
                    id: string;
                    branchId: string;
                    createdAt: string;
                    referenceType: string | null;
                    referenceId: string | null;
                    itemId: string;
                    txnType: "OPENING" | "ADJUSTMENT_PLUS" | "ADJUSTMENT_MINUS" | "SALE" | "RETURN";
                    qtyIn: number;
                    qtyOut: number;
                    reason: string | null;
                }>, "many">;
            };
        };
    };
    sales: {
        create: {
            body: z.ZodObject<{
                branchId: z.ZodString;
                customerId: z.ZodString;
                lines: z.ZodArray<z.ZodObject<{
                    itemId: z.ZodString;
                    qty: z.ZodNumber;
                    rate: z.ZodNumber;
                    discountAmount: z.ZodDefault<z.ZodNumber>;
                    taxRate: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    taxRate: number;
                    itemId: string;
                    qty: number;
                    rate: number;
                    discountAmount: number;
                }, {
                    taxRate: number;
                    itemId: string;
                    qty: number;
                    rate: number;
                    discountAmount?: number | undefined;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                branchId: string;
                customerId: string;
                lines: {
                    taxRate: number;
                    itemId: string;
                    qty: number;
                    rate: number;
                    discountAmount: number;
                }[];
            }, {
                branchId: string;
                customerId: string;
                lines: {
                    taxRate: number;
                    itemId: string;
                    qty: number;
                    rate: number;
                    discountAmount?: number | undefined;
                }[];
            }>;
            method: "POST";
            path: "/sales";
            responses: {
                201: z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    invoiceNo: z.ZodString;
                    customerId: z.ZodString;
                    subTotal: z.ZodNumber;
                    discountTotal: z.ZodNumber;
                    taxTotal: z.ZodNumber;
                    grandTotal: z.ZodNumber;
                    paidTotal: z.ZodNumber;
                    status: z.ZodEnum<["DRAFT", "SETTLED", "PARTIALLY_SETTLED", "CANCELLED"]>;
                    createdBy: z.ZodString;
                    createdAt: z.ZodString;
                } & {
                    lines: z.ZodArray<z.ZodObject<{
                        itemId: z.ZodString;
                        qty: z.ZodNumber;
                        rate: z.ZodNumber;
                        discountAmount: z.ZodDefault<z.ZodNumber>;
                        taxRate: z.ZodNumber;
                    } & {
                        id: z.ZodString;
                        taxableAmount: z.ZodNumber;
                        taxAmount: z.ZodNumber;
                        netAmount: z.ZodNumber;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                        taxRate: number;
                        itemId: string;
                        qty: number;
                        rate: number;
                        discountAmount: number;
                        taxableAmount: number;
                        taxAmount: number;
                        netAmount: number;
                    }, {
                        id: string;
                        taxRate: number;
                        itemId: string;
                        qty: number;
                        rate: number;
                        taxableAmount: number;
                        taxAmount: number;
                        netAmount: number;
                        discountAmount?: number | undefined;
                    }>, "many">;
                    payments: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        invoiceId: z.ZodString;
                        mode: z.ZodEnum<["CASH", "CARD", "WALLET"]>;
                        amount: z.ZodNumber;
                        reference: z.ZodNullable<z.ZodString>;
                        createdAt: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        mode: "CASH" | "CARD" | "WALLET";
                        reference: string | null;
                    }, {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        mode: "CASH" | "CARD" | "WALLET";
                        reference: string | null;
                    }>, "many">;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                    branchId: string;
                    createdAt: string;
                    customerId: string;
                    invoiceNo: string;
                    subTotal: number;
                    discountTotal: number;
                    taxTotal: number;
                    grandTotal: number;
                    paidTotal: number;
                    createdBy: string;
                    lines: {
                        id: string;
                        taxRate: number;
                        itemId: string;
                        qty: number;
                        rate: number;
                        discountAmount: number;
                        taxableAmount: number;
                        taxAmount: number;
                        netAmount: number;
                    }[];
                    payments: {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        mode: "CASH" | "CARD" | "WALLET";
                        reference: string | null;
                    }[];
                }, {
                    id: string;
                    status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                    branchId: string;
                    createdAt: string;
                    customerId: string;
                    invoiceNo: string;
                    subTotal: number;
                    discountTotal: number;
                    taxTotal: number;
                    grandTotal: number;
                    paidTotal: number;
                    createdBy: string;
                    lines: {
                        id: string;
                        taxRate: number;
                        itemId: string;
                        qty: number;
                        rate: number;
                        taxableAmount: number;
                        taxAmount: number;
                        netAmount: number;
                        discountAmount?: number | undefined;
                    }[];
                    payments: {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        mode: "CASH" | "CARD" | "WALLET";
                        reference: string | null;
                    }[];
                }>;
            };
        };
        settle: {
            body: z.ZodObject<{
                payments: z.ZodArray<z.ZodObject<{
                    mode: z.ZodEnum<["CASH", "CARD", "WALLET"]>;
                    amount: z.ZodNumber;
                    reference: z.ZodOptional<z.ZodString>;
                }, "strip", z.ZodTypeAny, {
                    amount: number;
                    mode: "CASH" | "CARD" | "WALLET";
                    reference?: string | undefined;
                }, {
                    amount: number;
                    mode: "CASH" | "CARD" | "WALLET";
                    reference?: string | undefined;
                }>, "many">;
            }, "strip", z.ZodTypeAny, {
                payments: {
                    amount: number;
                    mode: "CASH" | "CARD" | "WALLET";
                    reference?: string | undefined;
                }[];
            }, {
                payments: {
                    amount: number;
                    mode: "CASH" | "CARD" | "WALLET";
                    reference?: string | undefined;
                }[];
            }>;
            method: "POST";
            path: "/sales/:id/settle";
            responses: {
                200: z.ZodObject<{
                    invoice: z.ZodObject<{
                        id: z.ZodString;
                        branchId: z.ZodString;
                        invoiceNo: z.ZodString;
                        customerId: z.ZodString;
                        subTotal: z.ZodNumber;
                        discountTotal: z.ZodNumber;
                        taxTotal: z.ZodNumber;
                        grandTotal: z.ZodNumber;
                        paidTotal: z.ZodNumber;
                        status: z.ZodEnum<["DRAFT", "SETTLED", "PARTIALLY_SETTLED", "CANCELLED"]>;
                        createdBy: z.ZodString;
                        createdAt: z.ZodString;
                    } & {
                        lines: z.ZodArray<z.ZodObject<{
                            itemId: z.ZodString;
                            qty: z.ZodNumber;
                            rate: z.ZodNumber;
                            discountAmount: z.ZodDefault<z.ZodNumber>;
                            taxRate: z.ZodNumber;
                        } & {
                            id: z.ZodString;
                            taxableAmount: z.ZodNumber;
                            taxAmount: z.ZodNumber;
                            netAmount: z.ZodNumber;
                        }, "strip", z.ZodTypeAny, {
                            id: string;
                            taxRate: number;
                            itemId: string;
                            qty: number;
                            rate: number;
                            discountAmount: number;
                            taxableAmount: number;
                            taxAmount: number;
                            netAmount: number;
                        }, {
                            id: string;
                            taxRate: number;
                            itemId: string;
                            qty: number;
                            rate: number;
                            taxableAmount: number;
                            taxAmount: number;
                            netAmount: number;
                            discountAmount?: number | undefined;
                        }>, "many">;
                        payments: z.ZodArray<z.ZodObject<{
                            id: z.ZodString;
                            invoiceId: z.ZodString;
                            mode: z.ZodEnum<["CASH", "CARD", "WALLET"]>;
                            amount: z.ZodNumber;
                            reference: z.ZodNullable<z.ZodString>;
                            createdAt: z.ZodString;
                        }, "strip", z.ZodTypeAny, {
                            id: string;
                            createdAt: string;
                            amount: number;
                            invoiceId: string;
                            mode: "CASH" | "CARD" | "WALLET";
                            reference: string | null;
                        }, {
                            id: string;
                            createdAt: string;
                            amount: number;
                            invoiceId: string;
                            mode: "CASH" | "CARD" | "WALLET";
                            reference: string | null;
                        }>, "many">;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                        status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                        branchId: string;
                        createdAt: string;
                        customerId: string;
                        invoiceNo: string;
                        subTotal: number;
                        discountTotal: number;
                        taxTotal: number;
                        grandTotal: number;
                        paidTotal: number;
                        createdBy: string;
                        lines: {
                            id: string;
                            taxRate: number;
                            itemId: string;
                            qty: number;
                            rate: number;
                            discountAmount: number;
                            taxableAmount: number;
                            taxAmount: number;
                            netAmount: number;
                        }[];
                        payments: {
                            id: string;
                            createdAt: string;
                            amount: number;
                            invoiceId: string;
                            mode: "CASH" | "CARD" | "WALLET";
                            reference: string | null;
                        }[];
                    }, {
                        id: string;
                        status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                        branchId: string;
                        createdAt: string;
                        customerId: string;
                        invoiceNo: string;
                        subTotal: number;
                        discountTotal: number;
                        taxTotal: number;
                        grandTotal: number;
                        paidTotal: number;
                        createdBy: string;
                        lines: {
                            id: string;
                            taxRate: number;
                            itemId: string;
                            qty: number;
                            rate: number;
                            taxableAmount: number;
                            taxAmount: number;
                            netAmount: number;
                            discountAmount?: number | undefined;
                        }[];
                        payments: {
                            id: string;
                            createdAt: string;
                            amount: number;
                            invoiceId: string;
                            mode: "CASH" | "CARD" | "WALLET";
                            reference: string | null;
                        }[];
                    }>;
                    receipt: z.ZodObject<{
                        id: z.ZodString;
                        receiptNo: z.ZodString;
                        invoiceId: z.ZodString;
                        amount: z.ZodNumber;
                        createdAt: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        receiptNo: string;
                    }, {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        receiptNo: string;
                    }>;
                }, "strip", z.ZodTypeAny, {
                    invoice: {
                        id: string;
                        status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                        branchId: string;
                        createdAt: string;
                        customerId: string;
                        invoiceNo: string;
                        subTotal: number;
                        discountTotal: number;
                        taxTotal: number;
                        grandTotal: number;
                        paidTotal: number;
                        createdBy: string;
                        lines: {
                            id: string;
                            taxRate: number;
                            itemId: string;
                            qty: number;
                            rate: number;
                            discountAmount: number;
                            taxableAmount: number;
                            taxAmount: number;
                            netAmount: number;
                        }[];
                        payments: {
                            id: string;
                            createdAt: string;
                            amount: number;
                            invoiceId: string;
                            mode: "CASH" | "CARD" | "WALLET";
                            reference: string | null;
                        }[];
                    };
                    receipt: {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        receiptNo: string;
                    };
                }, {
                    invoice: {
                        id: string;
                        status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                        branchId: string;
                        createdAt: string;
                        customerId: string;
                        invoiceNo: string;
                        subTotal: number;
                        discountTotal: number;
                        taxTotal: number;
                        grandTotal: number;
                        paidTotal: number;
                        createdBy: string;
                        lines: {
                            id: string;
                            taxRate: number;
                            itemId: string;
                            qty: number;
                            rate: number;
                            taxableAmount: number;
                            taxAmount: number;
                            netAmount: number;
                            discountAmount?: number | undefined;
                        }[];
                        payments: {
                            id: string;
                            createdAt: string;
                            amount: number;
                            invoiceId: string;
                            mode: "CASH" | "CARD" | "WALLET";
                            reference: string | null;
                        }[];
                    };
                    receipt: {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        receiptNo: string;
                    };
                }>;
            };
        };
        list: {
            query: z.ZodObject<{
                branchId: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                branchId: string;
            }, {
                branchId: string;
            }>;
            method: "GET";
            path: "/sales";
            responses: {
                200: z.ZodArray<z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    invoiceNo: z.ZodString;
                    customerId: z.ZodString;
                    subTotal: z.ZodNumber;
                    discountTotal: z.ZodNumber;
                    taxTotal: z.ZodNumber;
                    grandTotal: z.ZodNumber;
                    paidTotal: z.ZodNumber;
                    status: z.ZodEnum<["DRAFT", "SETTLED", "PARTIALLY_SETTLED", "CANCELLED"]>;
                    createdBy: z.ZodString;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                    branchId: string;
                    createdAt: string;
                    customerId: string;
                    invoiceNo: string;
                    subTotal: number;
                    discountTotal: number;
                    taxTotal: number;
                    grandTotal: number;
                    paidTotal: number;
                    createdBy: string;
                }, {
                    id: string;
                    status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                    branchId: string;
                    createdAt: string;
                    customerId: string;
                    invoiceNo: string;
                    subTotal: number;
                    discountTotal: number;
                    taxTotal: number;
                    grandTotal: number;
                    paidTotal: number;
                    createdBy: string;
                }>, "many">;
            };
        };
        getById: {
            method: "GET";
            path: "/sales/:id";
            responses: {
                200: z.ZodObject<{
                    id: z.ZodString;
                    branchId: z.ZodString;
                    invoiceNo: z.ZodString;
                    customerId: z.ZodString;
                    subTotal: z.ZodNumber;
                    discountTotal: z.ZodNumber;
                    taxTotal: z.ZodNumber;
                    grandTotal: z.ZodNumber;
                    paidTotal: z.ZodNumber;
                    status: z.ZodEnum<["DRAFT", "SETTLED", "PARTIALLY_SETTLED", "CANCELLED"]>;
                    createdBy: z.ZodString;
                    createdAt: z.ZodString;
                } & {
                    lines: z.ZodArray<z.ZodObject<{
                        itemId: z.ZodString;
                        qty: z.ZodNumber;
                        rate: z.ZodNumber;
                        discountAmount: z.ZodDefault<z.ZodNumber>;
                        taxRate: z.ZodNumber;
                    } & {
                        id: z.ZodString;
                        taxableAmount: z.ZodNumber;
                        taxAmount: z.ZodNumber;
                        netAmount: z.ZodNumber;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                        taxRate: number;
                        itemId: string;
                        qty: number;
                        rate: number;
                        discountAmount: number;
                        taxableAmount: number;
                        taxAmount: number;
                        netAmount: number;
                    }, {
                        id: string;
                        taxRate: number;
                        itemId: string;
                        qty: number;
                        rate: number;
                        taxableAmount: number;
                        taxAmount: number;
                        netAmount: number;
                        discountAmount?: number | undefined;
                    }>, "many">;
                    payments: z.ZodArray<z.ZodObject<{
                        id: z.ZodString;
                        invoiceId: z.ZodString;
                        mode: z.ZodEnum<["CASH", "CARD", "WALLET"]>;
                        amount: z.ZodNumber;
                        reference: z.ZodNullable<z.ZodString>;
                        createdAt: z.ZodString;
                    }, "strip", z.ZodTypeAny, {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        mode: "CASH" | "CARD" | "WALLET";
                        reference: string | null;
                    }, {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        mode: "CASH" | "CARD" | "WALLET";
                        reference: string | null;
                    }>, "many">;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                    branchId: string;
                    createdAt: string;
                    customerId: string;
                    invoiceNo: string;
                    subTotal: number;
                    discountTotal: number;
                    taxTotal: number;
                    grandTotal: number;
                    paidTotal: number;
                    createdBy: string;
                    lines: {
                        id: string;
                        taxRate: number;
                        itemId: string;
                        qty: number;
                        rate: number;
                        discountAmount: number;
                        taxableAmount: number;
                        taxAmount: number;
                        netAmount: number;
                    }[];
                    payments: {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        mode: "CASH" | "CARD" | "WALLET";
                        reference: string | null;
                    }[];
                }, {
                    id: string;
                    status: "DRAFT" | "SETTLED" | "PARTIALLY_SETTLED" | "CANCELLED";
                    branchId: string;
                    createdAt: string;
                    customerId: string;
                    invoiceNo: string;
                    subTotal: number;
                    discountTotal: number;
                    taxTotal: number;
                    grandTotal: number;
                    paidTotal: number;
                    createdBy: string;
                    lines: {
                        id: string;
                        taxRate: number;
                        itemId: string;
                        qty: number;
                        rate: number;
                        taxableAmount: number;
                        taxAmount: number;
                        netAmount: number;
                        discountAmount?: number | undefined;
                    }[];
                    payments: {
                        id: string;
                        createdAt: string;
                        amount: number;
                        invoiceId: string;
                        mode: "CASH" | "CARD" | "WALLET";
                        reference: string | null;
                    }[];
                }>;
            };
        };
        returns: {
            body: z.ZodObject<{
                lines: z.ZodArray<z.ZodObject<{
                    saleLineId: z.ZodString;
                    qty: z.ZodNumber;
                }, "strip", z.ZodTypeAny, {
                    qty: number;
                    saleLineId: string;
                }, {
                    qty: number;
                    saleLineId: string;
                }>, "many">;
                refundMode: z.ZodEnum<["CASH", "CARD", "WALLET"]>;
            }, "strip", z.ZodTypeAny, {
                lines: {
                    qty: number;
                    saleLineId: string;
                }[];
                refundMode: "CASH" | "CARD" | "WALLET";
            }, {
                lines: {
                    qty: number;
                    saleLineId: string;
                }[];
                refundMode: "CASH" | "CARD" | "WALLET";
            }>;
            method: "POST";
            path: "/sales/:id/return";
            responses: {
                201: z.ZodObject<{
                    id: z.ZodString;
                    saleInvoiceId: z.ZodString;
                    returnNo: z.ZodString;
                    totalAmount: z.ZodNumber;
                    refundMode: z.ZodEnum<["CASH", "CARD", "WALLET"]>;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    createdAt: string;
                    saleInvoiceId: string;
                    returnNo: string;
                    totalAmount: number;
                    refundMode: "CASH" | "CARD" | "WALLET";
                }, {
                    id: string;
                    createdAt: string;
                    saleInvoiceId: string;
                    returnNo: string;
                    totalAmount: number;
                    refundMode: "CASH" | "CARD" | "WALLET";
                }>;
            };
        };
    };
    receipts: {
        getById: {
            method: "GET";
            path: "/receipts/:id";
            responses: {
                200: z.ZodObject<{
                    id: z.ZodString;
                    receiptNo: z.ZodString;
                    invoiceId: z.ZodString;
                    amount: z.ZodNumber;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    createdAt: string;
                    amount: number;
                    invoiceId: string;
                    receiptNo: string;
                }, {
                    id: string;
                    createdAt: string;
                    amount: number;
                    invoiceId: string;
                    receiptNo: string;
                }>;
            };
        };
        getByInvoice: {
            method: "GET";
            path: "/receipts/by-invoice/:invoiceId";
            responses: {
                200: z.ZodObject<{
                    id: z.ZodString;
                    receiptNo: z.ZodString;
                    invoiceId: z.ZodString;
                    amount: z.ZodNumber;
                    createdAt: z.ZodString;
                }, "strip", z.ZodTypeAny, {
                    id: string;
                    createdAt: string;
                    amount: number;
                    invoiceId: string;
                    receiptNo: string;
                }, {
                    id: string;
                    createdAt: string;
                    amount: number;
                    invoiceId: string;
                    receiptNo: string;
                }>;
            };
        };
    };
};
export type AppContract = typeof appContract;
//# sourceMappingURL=index.d.ts.map