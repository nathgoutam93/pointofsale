export declare const api: {
    auth: {
        login: (args: {
            body: {
                username: string;
                password: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
                branchId: string;
                token: string;
                userId: string;
                role: "ADMIN" | "CASHIER";
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        me: (args?: {
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        } | undefined) => Promise<{
            status: 200;
            body: {
                branchId: string;
                userId: string;
                role: "ADMIN" | "CASHIER";
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
    };
    customers: {
        list: (args: {
            query: {
                branchId: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
                id: string;
                name: string;
                code: string;
                branchId: string;
                phone: string | null;
                isWalkIn: boolean;
                createdAt: string;
            }[];
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        create: (args: {
            body: {
                name: string;
                branchId: string;
                phone?: string | undefined;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 201;
            body: {
                id: string;
                name: string;
                code: string;
                branchId: string;
                phone: string | null;
                isWalkIn: boolean;
                createdAt: string;
            };
            headers: Headers;
        } | {
            status: 200 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        getWalkIn: (args: {
            params: {
                branchId: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
                id: string;
                name: string;
                code: string;
                branchId: string;
                phone: string | null;
                isWalkIn: boolean;
                createdAt: string;
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        getWallet: (args: {
            params: {
                id: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
                branchId: string;
                customerId: string;
                balance: number;
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        topupWallet: (args: {
            params: {
                id: string;
            };
            body: {
                amount: number;
                reference?: string | undefined;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
                id: string;
                type: "TOPUP" | "DEBIT_SALE" | "REFUND_RETURN" | "ADJUSTMENT";
                createdAt: string;
                walletAccountId: string;
                amount: number;
                referenceType: string | null;
                referenceId: string | null;
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
    };
    items: {
        list: (args?: {
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
            query?: {
                activeOnly?: boolean | undefined;
            } | undefined;
        } | undefined) => Promise<{
            status: 200;
            body: {
                id: string;
                name: string;
                code: string;
                createdAt: string;
                category: string | null;
                uom: string;
                sellPrice: number;
                taxRate: number;
                isActive: boolean;
            }[];
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        create: (args: {
            body: {
                name: string;
                code: string;
                uom: string;
                sellPrice: number;
                taxRate: number;
                category?: string | undefined;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 201;
            body: {
                id: string;
                name: string;
                code: string;
                createdAt: string;
                category: string | null;
                uom: string;
                sellPrice: number;
                taxRate: number;
                isActive: boolean;
            };
            headers: Headers;
        } | {
            status: 200 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        update: (args: {
            params: {
                id: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
            body?: {
                name?: string | undefined;
                category?: string | null | undefined;
                uom?: string | undefined;
                sellPrice?: number | undefined;
                taxRate?: number | undefined;
                isActive?: boolean | undefined;
            } | undefined;
        }) => Promise<{
            status: 200;
            body: {
                id: string;
                name: string;
                code: string;
                createdAt: string;
                category: string | null;
                uom: string;
                sellPrice: number;
                taxRate: number;
                isActive: boolean;
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
    };
    stock: {
        opening: (args: {
            body: {
                branchId: string;
                itemId: string;
                qty: number;
                reason?: string | undefined;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 201;
            body: {
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
            };
            headers: Headers;
        } | {
            status: 200 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        adjustment: (args: {
            body: {
                branchId: string;
                itemId: string;
                qty: number;
                reason: string;
                direction: "IN" | "OUT";
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 201;
            body: {
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
            };
            headers: Headers;
        } | {
            status: 200 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        onHand: (args: {
            query: {
                branchId: string;
                itemId?: string | undefined;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
                itemId: string;
                onHand: number;
            }[];
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        ledger: (args: {
            query: {
                branchId: string;
                itemId?: string | undefined;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
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
            }[];
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
    };
    sales: {
        create: (args: {
            body: {
                branchId: string;
                customerId: string;
                lines: {
                    taxRate: number;
                    itemId: string;
                    qty: number;
                    rate: number;
                    discountAmount?: number | undefined;
                }[];
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 201;
            body: {
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
            headers: Headers;
        } | {
            status: 200 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        settle: (args: {
            params: {
                id: string;
            };
            body: {
                payments: {
                    amount: number;
                    mode: "CASH" | "CARD" | "WALLET";
                    reference?: string | undefined;
                }[];
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
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
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        list: (args: {
            query: {
                branchId: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
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
            }[];
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        getById: (args: {
            params: {
                id: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
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
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        returns: (args: {
            params: {
                id: string;
            };
            body: {
                lines: {
                    qty: number;
                    saleLineId: string;
                }[];
                refundMode: "CASH" | "CARD" | "WALLET";
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 201;
            body: {
                id: string;
                createdAt: string;
                saleInvoiceId: string;
                returnNo: string;
                totalAmount: number;
                refundMode: "CASH" | "CARD" | "WALLET";
            };
            headers: Headers;
        } | {
            status: 200 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
    };
    receipts: {
        getById: (args: {
            params: {
                id: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
                id: string;
                createdAt: string;
                amount: number;
                invoiceId: string;
                receiptNo: string;
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
        getByInvoice: (args: {
            params: {
                invoiceId: string;
            };
            cache?: RequestCache | undefined;
            fetchOptions?: import("@ts-rest/core").FetchOptions | undefined;
            extraHeaders?: Record<string, string | undefined> | undefined;
            overrideClientOptions?: Partial<import("@ts-rest/core").OverrideableClientArgs> | undefined;
        }) => Promise<{
            status: 200;
            body: {
                id: string;
                createdAt: string;
                amount: number;
                invoiceId: string;
                receiptNo: string;
            };
            headers: Headers;
        } | {
            status: 201 | 100 | 101 | 102 | 202 | 203 | 204 | 205 | 206 | 207 | 300 | 301 | 302 | 303 | 304 | 305 | 307 | 308 | 400 | 401 | 402 | 403 | 404 | 405 | 406 | 407 | 408 | 409 | 410 | 411 | 412 | 413 | 414 | 415 | 416 | 417 | 418 | 419 | 420 | 421 | 422 | 423 | 424 | 428 | 429 | 431 | 451 | 500 | 501 | 502 | 503 | 504 | 505 | 507 | 511;
            body: unknown;
            headers: Headers;
        }>;
    };
};
export declare function authHeaders(): {
    Authorization?: undefined;
} | {
    Authorization: string;
};
//# sourceMappingURL=api.d.ts.map