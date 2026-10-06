import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { invoiceDue, returnLineAmounts, round2, sanitizeReceiptCss, splitReturn } from "@pos/contracts";
import { api, apiErrorMessage, authHeaders, uploadSrc } from "../lib/api";
import { usePrintTemplate, useReceiptPrinting } from "../lib/printing";
import { branchReceiptTemplate, rateFromAmounts, receiptStyleFor, renderReceipt, returnReceiptDocument } from "../lib/receipt";
import { ReceiptPrintStyles } from "./pos/ReceiptPrintStyles";
import { can } from "../lib/session";
import { requireOperationalSession } from "./route-helpers";
import { NewReturnForm } from "./returns/NewReturnForm";
import { ReturnDetails } from "./returns/ReturnDetails";
import { ReturnsList } from "./returns/ReturnsList";
import { formatReceiptQty, isMultipleOfLeastCount, leastCountStepText, normalizeLeastCount } from "./returns/returnQty";
import type { ReturnRefundMode } from "./returns/types";
import { useBillSearch } from "./returns/useBillSearch";
import { useReturns } from "./returns/useReturns";

export function ReturnsPage() {
  const session = requireOperationalSession();
  const queryClient = useQueryClient();

  const [createMode, setCreateMode] = useState(false);
  const [selectedReturnId, setSelectedReturnId] = useState("");
  const [selectedInvoiceId, setSelectedInvoiceId] = useState("");
  const [invoiceSearch, setInvoiceSearch] = useState("");
  const [refundMode, setRefundMode] = useState<ReturnRefundMode>("CASH");
  const [reason, setReason] = useState("");
  // Cashiers need an admin's permission to take goods back.
  const mayReturn = can(session, "MAKE_RETURNS");
  const [lineQtyMap, setLineQtyMap] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const receiptPrinting = useReceiptPrinting();

  const { returnPages, returnsList, returnDetail } = useReturns({
    branchId: session.branchId,
    selectedReturnId,
    createMode,
  });

  const { sales } = useBillSearch({ branchId: session.branchId, invoiceSearch, createMode });

  const items = useQuery({
    queryKey: ["items-returns"],
    enabled: createMode,
    queryFn: async () => {
      const res = await api.items.list({ extraHeaders: authHeaders() });
      if (res.status !== 200) throw new Error("Failed to load items");
      return res.body;
    },
  });

  const customers = useQuery({
    queryKey: ["customers-returns", session.branchId],
    enabled: createMode,
    queryFn: async () => {
      const res = await api.customers.list({
        query: { branchId: session.branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load customers");
      return res.body;
    },
  });

  const branchSettings = useQuery({
    queryKey: ["branch-settings", session.branchId],
    queryFn: async () => {
      const res = await api.branches.get({
        params: { id: session.branchId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load branch settings");
      return res.body;
    },
  });

  const businessSettings = useQuery({
    queryKey: ["business-settings"],
    queryFn: async () => {
      const res = await api.business.get({
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load business settings");
      return res.body;
    },
  });

  const selectedInvoiceDetails = useQuery({
    queryKey: ["sales-by-id", selectedInvoiceId],
    enabled: createMode && !!selectedInvoiceId,
    queryFn: async () => {
      const res = await api.sales.getById({
        params: { id: selectedInvoiceId },
        extraHeaders: authHeaders(),
      });
      if (res.status !== 200) throw new Error("Failed to load invoice details");
      return res.body;
    },
  });

  useEffect(() => {
    if (createMode || selectedReturnId) return;
    if ((returnsList.data ?? []).length > 0) {
      setSelectedReturnId(returnsList.data![0].id);
    }
  }, [createMode, selectedReturnId, returnsList.data]);

  const itemNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of items.data ?? []) map.set(item.id, item.name);
    return map;
  }, [items.data]);

  const itemLeastCountById = useMemo(() => {
    const map = new Map<string, number>();
    for (const item of items.data ?? []) {
      map.set(item.id, normalizeLeastCount(item.leastCount));
    }
    return map;
  }, [items.data]);

  const customerById = useMemo(() => {
    const map = new Map<string, { name: string; isWalkIn: boolean }>();
    for (const customer of customers.data ?? []) {
      map.set(customer.id, { name: customer.name, isWalkIn: customer.isWalkIn });
    }
    return map;
  }, [customers.data]);

  const selectedInvoice = useMemo(() => {
    if (!selectedInvoiceId) return null;
    return (sales.data ?? []).find((invoice) => invoice.id === selectedInvoiceId) ?? null;
  }, [sales.data, selectedInvoiceId]);

  const filteredInvoices = useMemo(() => {
    const query = invoiceSearch.trim().toLowerCase();
    if (!query) return [];
    return (sales.data ?? [])
      .filter((invoice) => {
        if (invoice.status === "CANCELLED") return false;
        const customer = customerById.get(invoice.customerId);
        const haystack = `${invoice.invoiceNo} ${customer?.name ?? ""}`.toLowerCase();
        return haystack.includes(query);
      })
      .slice(0, 20);
  }, [customerById, invoiceSearch, sales.data]);

  const selectedCustomer = selectedInvoice
    ? customerById.get(selectedInvoice.customerId)
    : undefined;
  const walletAllowed = !!selectedCustomer && !selectedCustomer.isWalkIn;

  const receiptHeaderLines = useMemo(() => {
    const raw = branchSettings.data?.receiptHeader ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.receiptHeader]);

  const receiptFooterLines = useMemo(() => {
    const raw = branchSettings.data?.receiptFooter ?? "";
    return raw
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
  }, [branchSettings.data?.receiptFooter]);

  const receiptLogoSrc = uploadSrc(branchSettings.data?.logoUrl ?? businessSettings.data?.logoUrl);

  const storeDisplayName = useMemo(() => {
    return (
      businessSettings.data?.name?.trim() ||
      branchSettings.data?.name?.trim() ||
      "Store"
    );
  }, [businessSettings.data?.name, branchSettings.data?.name]);

  // Branch CSS is admin-written; render only the sanitized, receipt-scoped rules.
  const customReceiptCss = useMemo(
    () => sanitizeReceiptCss(branchSettings.data?.receiptCss).css,
    [branchSettings.data?.receiptCss],
  );
  const branchTemplate = useMemo(() => branchReceiptTemplate(branchSettings.data), [branchSettings.data]);
  // On this computer's paper, when its printer takes other paper than the branch's.
  const receiptTemplate = usePrintTemplate(branchTemplate);

  useEffect(() => {
    if (refundMode === "WALLET" && !walletAllowed) setRefundMode("CASH");
  }, [refundMode, walletAllowed]);

  const returnLines = useMemo(() => {
    return (selectedInvoiceDetails.data?.lines ?? []).map((line) => {
      const soldQty = Number(line.qty);
      const alreadyReturned = (line.returnLines ?? []).reduce(
        (acc, returnedLine) => acc + Number(returnedLine.qty),
        0,
      );
      const availableQty = Math.max(0, soldQty - alreadyReturned);
      // What earlier returns already took from this line, part by part.
      const alreadyReturnedParts = (line.returnLines ?? []).reduce(
        (acc, returnedLine) => ({
          taxable: round2(acc.taxable + Number(returnedLine.taxableAmount)),
          cgst: round2(acc.cgst + Number(returnedLine.cgstAmount)),
          sgst: round2(acc.sgst + Number(returnedLine.sgstAmount)),
          igst: round2(acc.igst + Number(returnedLine.igstAmount)),
        }),
        { taxable: 0, cgst: 0, sgst: 0, igst: 0 },
      );
      const returnQty = Number(lineQtyMap[line.id] ?? 0);
      // The same calculation the server makes, so the amount shown is the amount refunded.
      const { amount } = returnLineAmounts({
        line: {
          taxable: Number(line.taxableAmount),
          cgst: Number(line.cgstAmount),
          sgst: Number(line.sgstAmount),
          igst: Number(line.igstAmount),
        },
        soldQty,
        alreadyReturnedQty: alreadyReturned,
        alreadyReturned: alreadyReturnedParts,
        qty: returnQty,
      });
      const leastCount = itemLeastCountById.get(line.itemId) ?? 1;

      return {
        lineId: line.id,
        itemId: line.itemId,
        itemName: itemNameById.get(line.itemId) ?? `Item ${line.itemId.slice(0, 6)}`,
        soldQty,
        alreadyReturned,
        availableQty,
        leastCount,
        leastCountStep: leastCountStepText(leastCount),
        rate: Number(line.rate),
        returnQty,
        amount,
      };
    });
  }, [itemLeastCountById, itemNameById, lineQtyMap, selectedInvoiceDetails.data?.lines]);

  const totalReturnAmount = useMemo(
    () => returnLines.reduce((acc, line) => round2(acc + line.amount), 0),
    [returnLines],
  );
  // A bill not yet paid in full: the return comes off what is still owed first.
  const selectedDue = selectedInvoice ? invoiceDue(selectedInvoice) : 0;
  const returnSplit = splitReturn(totalReturnAmount, selectedDue);

  const printableReturn = useMemo(() => {
    if (!returnDetail.data) return null;

    const detail = returnDetail.data;
    const items = detail.lines.map((line) => {
      const qty = Number(line.qty);
      const amount = Number(line.amount);
      const taxable = Number(line.taxableAmount);
      const taxAmount = Number(line.taxAmount);
      return {
        name: line.itemName,
        hsn: null,
        qty,
        qtyLabel: formatReceiptQty(qty),
        rate: qty > 0 ? round2(taxable / qty) : 0,
        amount: taxable,
        taxRate: rateFromAmounts(taxable, taxAmount),
        taxAmount,
        discount: 0,
        total: amount,
        taxable,
      };
    });

    const doc = returnReceiptDocument({
      branding: { storeName: storeDisplayName, headerLines: receiptHeaderLines, footerLines: receiptFooterLines },
      returnNo: detail.returnNo,
      invoiceNo: detail.saleInvoiceNo,
      createdAt: detail.createdAt ?? new Date().toISOString(),
      customer: detail.customerName,
      refundMode: detail.refundMode,
      items,
      totalAmount: Number(detail.totalAmount),
      dueAdjusted: Number(detail.dueAdjusted ?? 0),
      timeZone: businessSettings.data?.timezone,
      tax: { cgst: Number(detail.cgstTotal), sgst: Number(detail.sgstTotal), igst: Number(detail.igstTotal) },
    });
    return renderReceipt(doc, receiptTemplate);
  }, [
    receiptTemplate,
    receiptFooterLines,
    receiptHeaderLines,
    returnDetail.data,
    storeDisplayName,
    businessSettings.data?.timezone,
  ]);
  const receiptStyle = receiptStyleFor(printableReturn ?? { columns: 48 }, receiptTemplate, customReceiptCss);

  const createReturn = useMutation({
    mutationFn: async () => {
      if (!selectedInvoiceId) throw new Error("Select an invoice");

      const lines = returnLines
        .filter((line) => line.returnQty > 0)
        .map((line) => ({ saleLineId: line.lineId, qty: line.returnQty }));

      if (lines.length === 0) throw new Error("Enter return quantity for at least one line");

      const hasInvalidQty = returnLines.some(
        (line) =>
          line.returnQty < 0 ||
          line.returnQty > line.availableQty ||
          (line.returnQty > 0 && !isMultipleOfLeastCount(line.returnQty, line.leastCount)),
      );
      if (hasInvalidQty) {
        throw new Error("Return qty must be valid, within available qty, and match least count");
      }

      const res = await api.sales.returns({
        params: { id: selectedInvoiceId },
        body: { lines, refundMode, reason: reason.trim() },
        extraHeaders: authHeaders(),
      });

      if (res.status !== 201) {
        throw new Error(apiErrorMessage(res.body, "Failed to create return"));
      }

      return res.body;
    },
    onSuccess: (result) => {
      if (result.refundMode === "CASH" && Number(result.refundAmount) > 0) void receiptPrinting.openDrawer();
      setMessage(`Return created: ${result.returnNo}`);
      setCreateMode(false);
      setSelectedReturnId(result.id);
      setSelectedInvoiceId("");
      setInvoiceSearch("");
      setLineQtyMap({});
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["returns-list", session.branchId] });
      queryClient.invalidateQueries({ queryKey: ["return-detail", result.id] });
      queryClient.invalidateQueries({ queryKey: ["sales-module", session.branchId] });
      queryClient.invalidateQueries({ queryKey: ["sales-by-id", selectedInvoiceId] });
      queryClient.invalidateQueries({ queryKey: ["stock-module", session.branchId] });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Failed to create return");
    },
  });

  return (
    <section className="grid grid-cols-1 xl:h-[calc(100vh-48px)] xl:grid-cols-[340px_1fr]">
      <ReceiptPrintStyles css={receiptStyle.css} />
      <ReturnsList
        mayReturn={mayReturn}
        onNewReturn={() => {
          setCreateMode(true);
          setReason("");
          setSelectedInvoiceId("");
          setInvoiceSearch("");
          setLineQtyMap({});
          setMessage("");
        }}
        returnsList={returnsList}
        returnPages={returnPages}
        createMode={createMode}
        selectedReturnId={selectedReturnId}
        onSelect={(returnId) => {
          setCreateMode(false);
          setSelectedReturnId(returnId);
          setMessage("");
        }}
      />

      <div className="overflow-y-auto bg-slate-100 p-6" data-tour="returns-details">
        {createMode ? (
          <NewReturnForm
            onCancel={() => {
              setCreateMode(false);
              setSelectedInvoiceId("");
              setInvoiceSearch("");
              setLineQtyMap({});
              setMessage("");
            }}
            invoiceSearch={invoiceSearch}
            setInvoiceSearch={setInvoiceSearch}
            filteredInvoices={filteredInvoices}
            selectedInvoiceId={selectedInvoiceId}
            onSelectInvoice={(invoice) => {
              setSelectedInvoiceId(invoice.id);
              setInvoiceSearch(invoice.invoiceNo);
              setLineQtyMap({});
              setMessage("");
            }}
            customerById={customerById}
            refundMode={refundMode}
            setRefundMode={setRefundMode}
            totalReturnAmount={totalReturnAmount}
            returnSplit={returnSplit}
            walletAllowed={walletAllowed}
            selectedInvoice={selectedInvoice}
            selectedCustomer={selectedCustomer}
            selectedDue={selectedDue}
            returnLines={returnLines}
            lineQtyMap={lineQtyMap}
            onLineQtyChange={(lineId, value) => {
              setLineQtyMap((prev) => ({ ...prev, [lineId]: value }));
              setMessage("");
            }}
            reason={reason}
            setReason={setReason}
            createReturn={createReturn}
            message={message}
          />
        ) : (
          <ReturnDetails
            returnDetail={returnDetail}
            selectedReturnId={selectedReturnId}
            printing={receiptPrinting.busy}
            printError={receiptPrinting.error}
            onPrint={() =>
              void receiptPrinting.print(receiptStyle)
            }
            printableReturn={printableReturn}
            receiptLogoSrc={receiptLogoSrc}
            message={message}
          />
        )}
      </div>
    </section>
  );
}
