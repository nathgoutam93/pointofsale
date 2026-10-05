import { c } from './contract/shared.js';
import { branchesRoutes, businessRoutes, countersRoutes, registersRoutes } from './contract/business.js';
import { accountsRoutes, authRoutes, businessesRoutes, metaRoutes, setupRoutes, usersRoutes } from './contract/auth.js';
import { customersRoutes } from './contract/customers.js';
import { itemGroupsRoutes, itemsRoutes, stockRoutes, transfersRoutes } from './contract/inventory.js';
import { expensesRoutes } from './contract/expenses.js';
import { purchasesRoutes, suppliersRoutes } from './contract/purchases.js';
import { receiptsRoutes, returnsRoutes, salesRoutes } from './contract/sales.js';
import { auditRoutes, billingRoutes, gstRoutes, reportsRoutes } from './contract/reports.js';

export { RECEIPT_CSS_MAX_LENGTH, RECEIPT_CSS_SCOPE, sanitizeReceiptCss } from './receiptCss.js';
export type { ReceiptCssResult } from './receiptCss.js';
export {
  paperFromLegacyCss,
  presetTemplate,
  RECEIPT_PAPER_IDS,
  RECEIPT_PAPERS,
  THERMAL_PAPER_IDS,
  RECEIPT_SECTION_LABELS,
  RECEIPT_SECTIONS,
  RECEIPT_STYLE_LABELS,
  RECEIPT_STYLE_PRESETS,
  RECEIPT_STYLES,
  receiptPaperSchema,
  receiptTemplateSchema,
  resolveReceiptTemplate
} from './receiptTemplate.js';
export type { ReceiptPaper, ReceiptSection, ReceiptSections, ReceiptStyle, ReceiptTemplate } from './receiptTemplate.js';
export { fitCenter, fitLeft, fitRight, receiptColumns, renderReceipt, tableColumns, wrapText } from './receiptLayout.js';
export { a4InvoiceCss, a4InvoiceHtml, indianNumberWords, rupeesInWords } from './receiptA4.js';
export type { ReceiptDocument, ReceiptDocumentItem, ReceiptField, ReceiptLine, RenderedReceipt } from './receiptLayout.js';
export { canEncodeCode128, code128Modules, code128Values } from './code128.js';
export {
  batchLabel,
  COMPOSITION_DECLARATION,
  formatReceiptDate,
  formatReceiptTime,
  gstDocumentTitle,
  gstFooterLines,
  gstMetadata,
  gstTaxAmounts,
  invoiceDue,
  invoiceGstOf,
  invoiceReceiptItems,
  rateFromAmounts,
  returnReceiptDocument,
  saleReceiptDocument,
  settingLines,
  splitReturn
} from './receiptDocuments.js';
export type { InvoiceGst, ReceiptBranding } from './receiptDocuments.js';
export { APP_VERSION, CLIENT_VERSION_HEADER, isOlderVersion, UPDATE_REQUIRED_STATUS } from './version.js';
export { crashDetails, crashReportSchema, crashReportsBodySchema, scrubCrashText } from './crash.js';
export type { CrashReport } from './crash.js';
export {
  addBillingPeriod,
  BILLING_PERIODS,
  billingCheckoutBodySchema,
  billingStateAt,
  billingStatusSchema,
  billingSummarySchema,
  GRACE_DAYS,
  PAYMENT_REQUIRED,
  PLAN_CODES,
  PLAN_LIMIT_REACHED,
  planByCode,
  PLANS,
  SUBSCRIPTION_GST_RATE,
  subscriptionGst,
  TRIAL_DAYS,
  TRIAL_PLAN
} from './billing.js';
export type { BillingPeriod, BillingState, BillingStatus, BillingSummary, Plan, PlanCode } from './billing.js';
export {
  MIGRATION_BUNDLE_FORMAT,
  MIGRATION_EXCLUDED_MODELS,
  MIGRATION_TABLES,
  migrationManifestSchema
} from './migration.js';
export type { MigrationImportResult, MigrationManifest, MigrationTable } from './migration.js';
export { hasValidCheckDigit, parseScaleBarcode, sameScaleItemCode, scaleBarcodeSchema } from './barcodes.js';
export type { ScaleBarcode } from './barcodes.js';
export {
  allocateDiscountAcrossBases,
  computeSaleTotals,
  exclusiveBase,
  lineTax,
  mrpProblem,
  priceWithTax,
  resolveDiscountAmounts,
  returnLineAmounts,
  round2,
  roundOffFor,
  roundedTotal,
  round3,
  roundTo,
  splitGst
} from './pricing.js';
export type { DiscountInput, GstAmounts, PricedLineInput, ResolvedDiscount, RoundOffMode, TaxMode } from './pricing.js';
export {
  chargesGst,
  COMPOSITION_CATEGORIES,
  COMPOSITION_CATEGORY_LABELS,
  COMPOSITION_RATES,
  documentTypeFor,
  defaultSupplyType,
  BRANCH_CODE_LENGTH,
  branchCodeProblem,
  documentNumber,
  documentSeries,
  documentYearCode,
  financialYearCode,
  financialYearLabel,
  financialYearStart,
  GST_DOCUMENT_NUMBER_MAX_LENGTH,
  MAX_COUNTERS_PER_BRANCH,
  GST_DOCUMENT_TYPES,
  GST_STATES,
  GST_SUPPLY_TYPE_LABELS,
  GST_SUPPLY_TYPES,
  GST_UQCS,
  gstinCheckCharacter,
  gstinProblem,
  gstStateLabel,
  hsnProblem,
  isGstStateCode,
  isGstUqc,
  suggestUqc,
  supplyTypeProblem,
  TAXPAYER_TYPES,
  UOM_TO_UQC
} from './gst.js';
export type { CompositionCategory, GstDocumentType, GstSupplyType, TaxpayerType } from './gst.js';
export {
  branchSchema,
  calendarDateSchema,
  CASHIER_PERMISSION_LABELS,
  CASHIER_PERMISSIONS,
  cashierPermissionSchema,
  hasPermission,
  isValidTimeZone,
  moneySchema,
  supplierPaymentModeSchema
} from './contract/shared.js';
export type { CashierPermission } from './contract/shared.js';
export {
  branchSettingsSchema,
  businessSettingsSchema,
  counterSchema,
  DEVICE_HEADER,
  FALLBACK_SYNC_CONFLICT,
  FALLBACK_UNAVAILABLE,
  registerSessionSchema,
  registerSummarySchema,
  SERVER_UNREACHABLE,
  taxpayerTypeChangeSchema,
  taxpayerTypeSummarySchema
} from './contract/business.js';
export {
  EMAIL_VERIFICATION_REQUIRED,
  hostingSchema,
  localInstanceStatusSchema,
  metaSchema,
  migrationCompleteBodySchema,
  ownedBusinessSchema,
  PASSWORD_CHANGE_REQUIRED,
  posModeSchema,
  SESSION_COOKIE,
  SESSION_HEADER,
  userSchema
} from './contract/auth.js';
export type { Hosting, PosMode } from './contract/auth.js';
export {
  CREDIT_LIMIT_EXCEEDED,
  customerAccountSchema,
  customerSchema,
  customerStatementSchema,
  walletSchema,
  walletTopupModeSchema,
  walletTxnSchema
} from './contract/customers.js';
export type { CustomerAccount } from './contract/customers.js';
export { barcodeSvg, LABEL_LAYOUT_IDS, LABEL_LAYOUTS, labelProblem, labelsHtml, type LabelData, type LabelLayout, type LabelLayoutId, type LabelOptions } from './labels.js';
export { CASH_IN_REASONS, CASH_OUT_REASONS, cashMovementSchema, EXPENSE_CATEGORIES, expenseSchema } from './contract/expenses.js';
export { ITEM_IMPORT_COLUMNS, itemImportResultSchema, itemImportRowSchema, type ItemImportField, batchStockSchema, itemGroupDetailSchema, itemGroupSchema, itemSchema, itemWithSaleUomsSchema, lowStockSchema, onHandSchema } from './contract/inventory.js';
export { purchaseReturnSchema, supplierAccountSchema, supplierPaymentSchema, supplierSchema } from './contract/purchases.js';
export type { SupplierAccount } from './contract/purchases.js';
export { auditEventSchema, reportDetailSchema, salesExportQuerySchema } from './contract/reports.js';

export const appContract = c.router({
  gst: gstRoutes,
  /** Managed hosting only (404 elsewhere): the business's subscription. */
  billing: billingRoutes,
  meta: metaRoutes,
  setup: setupRoutes,
  businesses: businessesRoutes,
  accounts: accountsRoutes,
  auth: authRoutes,
  business: businessRoutes,
  branches: branchesRoutes,
  customers: customersRoutes,
  users: usersRoutes,
  counters: countersRoutes,
  registers: registersRoutes,
  items: itemsRoutes,
  /** Products sold in sizes and/or colours, each combination an item of its own. */
  itemGroups: itemGroupsRoutes,
  stock: stockRoutes,
  purchases: purchasesRoutes,
  /** Suppliers: their details, what is owed to them, and payments to them. */
  suppliers: suppliersRoutes,
  /** Cash in or out of the drawer, and the expense book. */
  expenses: expensesRoutes,
  transfers: transfersRoutes,
  sales: salesRoutes,
  receipts: receiptsRoutes,
  returns: returnsRoutes,
  /** Admins: who changed what (prices, cancellations, returns, staff, settings), newest first. */
  audit: auditRoutes,
  reports: reportsRoutes
});

export type AppContract = typeof appContract;
