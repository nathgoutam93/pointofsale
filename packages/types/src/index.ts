export enum UserRole {
  ADMIN = 'ADMIN',
  CASHIER = 'CASHIER'
}

export enum PaymentMode {
  CASH = 'CASH',
  CARD = 'CARD',
  WALLET = 'WALLET'
}

export enum WalletTxnType {
  TOPUP = 'TOPUP',
  DEBIT_SALE = 'DEBIT_SALE',
  REFUND_RETURN = 'REFUND_RETURN',
  ADJUSTMENT = 'ADJUSTMENT'
}

export enum StockTxnType {
  OPENING = 'OPENING',
  ADJUSTMENT_PLUS = 'ADJUSTMENT_PLUS',
  ADJUSTMENT_MINUS = 'ADJUSTMENT_MINUS',
  SALE = 'SALE',
  RETURN = 'RETURN'
}

export enum InvoiceStatus {
  DRAFT = 'DRAFT',
  SETTLED = 'SETTLED',
  PARTIALLY_SETTLED = 'PARTIALLY_SETTLED',
  CANCELLED = 'CANCELLED'
}

export type Money = number;
