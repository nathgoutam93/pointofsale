import { describe, expect, it } from "vitest";
import { cellText, parseCsv, tableToImport, templateCsv } from "./spreadsheet";

describe("parseCsv", () => {
  it("reads quotes, doubled quotes, line breaks in cells, CRLF and a BOM", () => {
    expect(parseCsv('\uFEFFCode,Name\r\nA1,"Soap, 100 g"\r\nA2,"Say ""hi""\nthere"\n')).toEqual([
      ["Code", "Name"],
      ["A1", "Soap, 100 g"],
      ["A2", 'Say "hi"\nthere'],
    ]);
  });

  it("takes the separator the header uses", () => {
    expect(parseCsv("Code;Name;MRP\nA1;Tea;1,50")).toEqual([
      ["Code", "Name", "MRP"],
      ["A1", "Tea", "1,50"],
    ]);
    expect(parseCsv("Code\tName\nA1\tTea")[1]).toEqual(["A1", "Tea"]);
  });
});

describe("tableToImport", () => {
  it("matches headers in any case and common other names, and skips empty rows", () => {
    const table = tableToImport([
      ["Item Code", "NAME", "Selling Price", "GST %", "Color", "Notes"],
      ["A1", "Tea", 120, 5, "Red", "ignored"],
      ["", "", null, undefined, "", ""],
      ["A2", "Coffee", 250.5, 18, "", ""],
    ]);
    expect(table.ignored).toEqual(["Notes"]);
    expect(table.fields).toEqual(["code", "name", "sellPrice", "gstRate", "colour"]);
    expect(table.rows).toEqual([
      { row: 2, code: "A1", name: "Tea", sellPrice: "120", gstRate: "5", colour: "Red" },
      { row: 4, code: "A2", name: "Coffee", sellPrice: "250.5", gstRate: "18", colour: "" },
    ]);
  });

  it("writes Excel dates and yes/no cells as text", () => {
    expect(cellText(new Date(2027, 2, 31))).toBe("2027-03-31");
    expect(cellText(true)).toBe("Yes");
    expect(cellText(0.1 + 0.2)).toBe("0.3");
  });

  it("reads its own template back", () => {
    const table = tableToImport(parseCsv(templateCsv()));
    expect(table.ignored).toEqual([]);
    expect(table.rows[0]).toMatchObject({ code: "SOAP-100", gstRate: "18", priceIncludesGst: "Yes" });
  });
});
