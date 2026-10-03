import { Injectable } from '@nestjs/common';
import {
  invoiceGstOf,
  invoiceReceiptItems,
  renderReceipt,
  resolveReceiptTemplate,
  saleReceiptDocument,
  settingLines,
  type RenderedReceipt
} from '@pos/contracts';
import { Mailer } from '../mail/mailer';
import { PrismaService } from '../prisma.service';
import { SalesService } from './sales.service';

const escapeHtml = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The receipt as an email: monospace lines, large ones at double size, like the printed one. */
function receiptHtml(receipt: RenderedReceipt) {
  const lines = receipt.lines
    .map((line) => {
      const style = line.large ? 'font-size:26px;line-height:1.15;font-weight:700' : line.strong ? 'font-weight:700' : '';
      return `<div style="white-space:pre;${style}">${escapeHtml(line.text) || '&nbsp;'}</div>`;
    })
    .join('');
  return `<!doctype html><html><body style="margin:0;padding:16px;background:#f8fafc"><div style="display:inline-block;padding:16px;background:#fff;border:1px solid #e2e8f0;font-family:Menlo,Consolas,'Courier New',monospace;font-size:13px;line-height:1.3;color:#111827">${lines}</div></body></html>`;
}

/**
 * Emails a sale's receipt to a customer. Built here from the invoice, with the branch's receipt
 * layout, so what is sent is the business's receipt and nothing else.
 */
@Injectable()
export class ReceiptEmailService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sales: SalesService,
    private readonly mailer: Mailer
  ) {}

  async send(branchId: string, invoiceId: string, to: string) {
    this.mailer.assertConfigured();
    const invoice = await this.sales.getSaleById(branchId, invoiceId);
    const [branch, business, items] = await Promise.all([
      this.prisma.branch.findUniqueOrThrow({
        where: { id: branchId },
        select: { name: true, receiptHeader: true, receiptFooter: true, invoiceFooter: true, receiptTemplate: true, receiptCss: true, invoiceCss: true }
      }),
      this.prisma.businessSettings.findUnique({ where: { id: 'default' }, select: { name: true, timezone: true } }),
      this.prisma.item.findMany({ where: { id: { in: invoice.lines.map((line) => line.itemId) } }, select: { id: true, uom: true } })
    ]);
    const unitById = new Map(items.map((item) => [item.id, item.uom]));
    const receiptFooter = settingLines(branch.receiptFooter);
    const storeName = business?.name?.trim() || branch.name;
    const doc = saleReceiptDocument({
      branding: {
        storeName,
        headerLines: settingLines(branch.receiptHeader),
        footerLines: receiptFooter.length > 0 ? receiptFooter : settingLines(branch.invoiceFooter)
      },
      invoiceNo: invoice.invoiceNo,
      createdAt: invoice.createdAt.toISOString(),
      cashier: invoice.createdByName ?? '',
      customer: invoice.customerName ?? '',
      gst: invoiceGstOf({
        documentType: invoice.documentType,
        sellerGstin: invoice.sellerGstin,
        sellerStateCode: invoice.sellerStateCode,
        placeOfSupplyStateCode: invoice.placeOfSupplyStateCode,
        cgstTotal: Number(invoice.cgstTotal),
        sgstTotal: Number(invoice.sgstTotal),
        igstTotal: Number(invoice.igstTotal)
      }),
      items: invoiceReceiptItems(
        invoice.lines.map((line) => ({
          ...line,
          qty: Number(line.qty),
          rate: Number(line.rate),
          taxRate: Number(line.taxRate),
          saleUomQty: line.saleUomQty === null ? null : Number(line.saleUomQty),
          discountAmount: Number(line.discountAmount),
          taxableAmount: Number(line.taxableAmount),
          taxAmount: Number(line.taxAmount),
          netAmount: Number(line.netAmount),
          discountAllocations: line.discountAllocations.map((allocation) => ({ discountId: allocation.discountId, amount: Number(allocation.amount) }))
        })),
        invoice.discounts,
        (itemId) => unitById.get(itemId)
      ),
      orderDiscount: Number(invoice.orderDiscountAmount ?? 0),
      grandTotal: Number(invoice.grandTotal),
      payments: invoice.payments.map((payment) => ({ mode: payment.mode, amount: Number(payment.amount) })),
      paidTotal: Number(invoice.paidTotal),
      creditedTotal: Number(invoice.creditedTotal),
      timeZone: business?.timezone ?? undefined
    });
    const receipt = renderReceipt(doc, resolveReceiptTemplate(branch.receiptTemplate, branch.receiptCss || branch.invoiceCss));
    await this.mailer.send({
      to,
      subject: `Your receipt from ${storeName}: ${invoice.invoiceNo}`,
      text: receipt.lines.map((line) => line.text.trimEnd()).join('\n'),
      html: receiptHtml(receipt)
    });
  }
}
