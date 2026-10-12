/** Runs inside createBackup's consistent snapshot, alongside stock and copied bills. */
export function registerBaselineSql(counterId: string) {
  if (!/^[0-9a-f-]{36}$/.test(counterId)) throw new Error('Invalid counter ID');
  const sum = (table: string, field: string, condition = '') =>
    `COALESCE((SELECT SUM("${field}") FROM "${table}" WHERE "registerSessionId" = r."id" ${condition}), 0)::numeric(14,2)`;
  const payment = (mode: string) => sum('Payment', 'amount', `AND "mode" = '${mode}'`);
  const topup = (mode: string) => sum('WalletTxn', 'amount', `AND "type" = 'TOPUP' AND "paymentMode" = '${mode}'`);
  const columns = {
    cashSales: payment('CASH'), cashTopups: topup('CASH'),
    cashRefunds: sum('ReturnInvoice', 'refundAmount', `AND "refundMode" = 'CASH'`),
    cashPaidOut: sum('SupplierPayment', 'amount'),
    cashIn: sum('CashMovement', 'amount', `AND "type" = 'CASH_IN'`),
    cashOut: sum('CashMovement', 'amount', `AND "type" = 'CASH_OUT'`),
    cashExpenses: sum('Expense', 'amount'),
    cardSales: `(${payment('CARD')} + ${topup('CARD')})`,
    upiSales: `(${payment('UPI')} + ${topup('UPI')})`
  };
  return `SELECT r."id" AS "registerId", ${Object.entries(columns).map(([name, sql]) => `${sql} AS "${name}"`).join(', ')}
    FROM "RegisterSession" r WHERE r."counterId" = '${counterId}' AND r."closedAt" IS NULL`;
}
