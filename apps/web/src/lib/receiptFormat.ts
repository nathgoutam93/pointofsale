export type ReceiptLine = {
  text: string;
  strong?: boolean;
};

export type ReceiptMetadata = {
  label: string;
  value: string;
};

export type ReceiptItem = {
  name: string;
  qty: number;
  price: number;
  total: number;
  subLine?: string;
  subLines?: string[];
};

export type ReceiptTotal = {
  label: string;
  value: string;
  isGrandTotal?: boolean;
};

export type ReceiptPayment = {
  label: string;
  value: string;
};

export type ReceiptLayout = {
  width: number;
  item: number;
  qty: number;
  price: number;
  total: number;
};

export const resolveReceiptWidth = (
  css: string | null | undefined,
  fallback = 48,
) => {
  if (!css) return fallback;
  const match = css.match(/--receipt-ch\\s*:\\s*(\\d+)/i);
  if (!match) return fallback;
  const value = Number(match[1]);
  if (value === 32 || value === 48) return value;
  return fallback;
};

const layoutForWidth = (width: number): ReceiptLayout => {
  if (width <= 32) {
    return { width: 32, item: 14, qty: 4, price: 6, total: 8 };
  }
  return { width: 48, item: 24, qty: 6, price: 8, total: 10 };
};

const repeat = (char: string, count: number) => char.repeat(Math.max(0, count));

const fitRight = (text: string, width: number) => {
  if (text.length >= width) return text.slice(0, width);
  return text.padStart(width, " ");
};

const fitLeft = (text: string, width: number) => {
  if (text.length >= width) return text.slice(0, width);
  return text.padEnd(width, " ");
};

const fitCenter = (text: string, width: number) => {
  if (text.length >= width) return text.slice(0, width);
  const left = Math.floor((width - text.length) / 2);
  const right = width - text.length - left;
  return `${repeat(" ", left)}${text}${repeat(" ", right)}`;
};

const wrapText = (text: string, width: number) => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [""];

  const lines: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.length > 0) {
      lines.push(current);
      current = "";
    }
  };

  for (const word of words) {
    if (word.length > width) {
      pushCurrent();
      for (let i = 0; i < word.length; i += width) {
        lines.push(word.slice(i, i + width));
      }
      continue;
    }

    if (!current) {
      current = word;
      continue;
    }

    if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      pushCurrent();
      current = word;
    }
  }

  pushCurrent();
  return lines;
};

const formatKeyValueLine = (
  label: string,
  value: string,
  width: number,
  labelWidth: number,
) => {
  const trimmedLabel = label.trim();
  const trimmedValue = value.trim();
  const left = fitLeft(trimmedLabel, labelWidth);
  const base = `${left} : `;
  const remaining = width - base.length;
  if (remaining <= 0)
    return `${trimmedLabel} : ${trimmedValue}`.slice(0, width);
  if (trimmedValue.length >= remaining)
    return `${base}${trimmedValue.slice(0, remaining)}`;
  return `${base}${trimmedValue.padStart(remaining, " ")}`;
};

const formatHeaderRow = (layout: ReceiptLayout) => {
  return (
    fitLeft("Item", layout.item) +
    fitRight("Qty", layout.qty) +
    fitRight("Price", layout.price) +
    fitRight("Total", layout.total)
  );
};

const formatItemRow = (layout: ReceiptLayout, item: ReceiptItem) => {
  const nameLines = wrapText(item.name, layout.item);
  const qty = fitRight(item.qty.toFixed(0), layout.qty);
  const price = fitRight(item.price.toFixed(2), layout.price);
  const total = fitRight(item.total.toFixed(2), layout.total);

  const lines: string[] = [];
  nameLines.forEach((nameLine, index) => {
    if (index === 0) {
      lines.push(fitLeft(nameLine, layout.item) + qty + price + total);
    } else {
      lines.push(fitLeft(nameLine, layout.width));
    }
  });

  const extraLines: string[] = [];
  if (item.subLine) extraLines.push(item.subLine);
  if (item.subLines && item.subLines.length > 0) {
    extraLines.push(...item.subLines.filter(Boolean));
  }
  extraLines.forEach((text) => {
    const wrapped = wrapText(text, layout.width);
    wrapped.forEach((wrappedLine) => {
      lines.push(fitLeft(wrappedLine, layout.width));
    });
  });

  return lines;
};

export const formatReceiptDate = (iso: string) => {
  const date = new Date(iso);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
};

export const formatReceiptTime = (iso: string) => {
  return new Date(iso).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
};

export const buildReceiptLines = (params: {
  width?: number;
  storeName: string;
  headerLines?: string[];
  metadata?: ReceiptMetadata[];
  items?: ReceiptItem[];
  totals?: ReceiptTotal[];
  payments?: ReceiptPayment[];
  footerLines?: string[];
}) => {
  const width = params.width ?? 48;
  const layout = layoutForWidth(width);
  const separator = repeat("-", layout.width);
  const lines: ReceiptLine[] = [];

  const pushLine = (text: string, strong = false) => {
    lines.push({ text, strong });
  };

  pushLine(fitCenter(params.storeName, layout.width), true);

  (params.headerLines ?? []).forEach((line) => {
    pushLine(fitCenter(line, layout.width));
  });

  pushLine(separator);

  const metadata = (params.metadata ?? []).filter(
    (entry) => entry.value.trim().length > 0,
  );

  if (metadata.length > 0) {
    const labelWidth = Math.min(
      Math.max(...metadata.map((entry) => entry.label.length)),
      Math.floor(layout.width * 0.4),
    );
    metadata.forEach((entry) => {
      pushLine(
        formatKeyValueLine(entry.label, entry.value, layout.width, labelWidth),
      );
    });
    pushLine(separator);
  }

  pushLine(formatHeaderRow(layout));
  pushLine(separator);

  (params.items ?? []).forEach((item) => {
    formatItemRow(layout, item).forEach((line) => pushLine(line));
  });

  pushLine(separator);

  const totals = params.totals ?? [];
  const normalTotals = totals.filter((total) => !total.isGrandTotal);
  const grandTotal = totals.find((total) => total.isGrandTotal);

  if (normalTotals.length > 0) {
    const labelWidth = Math.min(
      Math.max(...normalTotals.map((entry) => entry.label.length)),
      Math.floor(layout.width * 0.5),
    );
    normalTotals.forEach((entry) => {
      pushLine(
        formatKeyValueLine(entry.label, entry.value, layout.width, labelWidth),
      );
    });
  }

  if (grandTotal) {
    pushLine(separator);
    const labelWidth = Math.min(
      Math.max(grandTotal.label.length, 5),
      Math.floor(layout.width * 0.5),
    );
    pushLine(
      formatKeyValueLine(
        grandTotal.label,
        grandTotal.value,
        layout.width,
        labelWidth,
      ),
      true,
    );
  }

  pushLine(separator);

  const payments = params.payments ?? [];
  if (payments.length > 0) {
    const labelWidth = Math.min(
      Math.max(...payments.map((entry) => entry.label.length), 7),
      Math.floor(layout.width * 0.5),
    );
    payments.forEach((entry) => {
      pushLine(
        formatKeyValueLine(entry.label, entry.value, layout.width, labelWidth),
      );
    });
  }

  (params.footerLines ?? []).forEach((line) => {
    pushLine(fitCenter(line, layout.width));
  });

  return { lines, layout };
};
