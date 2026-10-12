import { ITEM_IMPORT_COLUMNS, type ItemImportField } from "@pos/contracts";

/**
 * Reads CSV text into rows of cells: quoted cells (with "" for a quote, and line breaks
 * inside), CRLF or LF lines, a leading BOM, and a comma, semicolon or tab separator (the one
 * the header line uses).
 */
export function parseCsv(input: string): string[][] {
  const text = input.replace(/^\uFEFF/, "");
  const firstLine = text.slice(0, text.search(/\r?\n|$/));
  const separator = [",", ";", "\t"].map((char) => ({ char, count: firstLine.split(char).length })).sort((a, b) => b.count - a.count)[0].char;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell === "") {
      quoted = true;
    } else if (char === separator) {
      row.push(cell);
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

/** A spreadsheet cell as text: numbers as written, dates as YYYY-MM-DD, true/false as Yes/No. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(Math.round(value * 1e6) / 1e6);
  return String(value).trim();
}

const normalise = (header: string) => header.toLowerCase().replace(/[^a-z0-9%]+/g, "");
const FIELD_BY_HEADER = new Map<string, ItemImportField>(
  ITEM_IMPORT_COLUMNS.flatMap((column) => [
    [normalise(column.header), column.field],
    [normalise(column.field), column.field],
  ]),
);
// A few other names people use.
for (const [alias, field] of [
  ["itemcode", "code"],
  ["sku", "code"],
  ["itemname", "name"],
  ["uom", "unit"],
  ["price", "sellPrice"],
  ["sellingprice", "sellPrice"],
  ["cost", "costPrice"],
  ["gst", "gstRate"],
  ["gstrate", "gstRate"],
  ["tax%", "gstRate"],
  ["hsncode", "hsnCode"],
  ["barcode", "barcodes"],
  ["stock", "openingStock"],
  ["qty", "openingStock"],
  ["color", "colour"],
  ["expiry", "expiryDate"],
] as const) {
  FIELD_BY_HEADER.set(alias, field);
}

export type ImportTable = {
  rows: Array<{ row: number } & Partial<Record<ItemImportField, string>>>;
  /** Headers matched to no column (ignored). */
  ignored: string[];
  /** Fields found, in the file's order. */
  fields: ItemImportField[];
};

/** The first row is the header; empty rows are skipped; row numbers are the sheet's (header = 1). */
export function tableToImport(table: unknown[][]): ImportTable {
  const [header = [], ...body] = table;
  const fields = header.map((cell) => FIELD_BY_HEADER.get(normalise(cellText(cell))) ?? null);
  const ignored = header.map(cellText).filter((name, index) => name !== "" && fields[index] === null);
  const rows: ImportTable["rows"] = [];
  body.forEach((cells, index) => {
    const entry: ImportTable["rows"][number] = { row: index + 2 };
    let any = false;
    fields.forEach((field, column) => {
      if (!field) return;
      const value = cellText(cells[column]).slice(0, 500);
      if (value !== "") any = true;
      entry[field] = value;
    });
    if (any) rows.push(entry);
  });
  return { rows, ignored, fields: fields.filter((field): field is ItemImportField => field !== null) };
}

/** The template: the header row and an example row, as CSV (Excel opens it). */
export function templateCsv() {
  const example: Partial<Record<ItemImportField, string>> = {
    code: "SOAP-100",
    name: "Neem Soap 100 g",
    category: "Personal care",
    unit: "PCS",
    sellPrice: "45",
    mrp: "50",
    costPrice: "32",
    gstRate: "18",
    priceIncludesGst: "Yes",
    hsnCode: "3401",
    barcodes: "8901234567890",
    openingStock: "24",
    reorderLevel: "6",
    reorderQty: "48",
  };
  const quote = (value: string) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return "\uFEFF" + [ITEM_IMPORT_COLUMNS.map((column) => column.header), ITEM_IMPORT_COLUMNS.map((column) => example[column.field] ?? "")]
    .map((row) => row.map(quote).join(","))
    .join("\r\n");
}
