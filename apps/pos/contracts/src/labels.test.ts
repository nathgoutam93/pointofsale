import { describe, expect, it } from 'vitest';
import { barcodeSvg, LABEL_LAYOUT_IDS, LABEL_LAYOUTS, labelProblem, labelsHtml, type LabelData } from './labels.js';
import { code128Modules } from './code128.js';

const rice: LabelData = { name: 'Basmati Rice <Premium> 1 kg', barcode: '8901234567890', price: 120, mrp: 150, batchNo: 'B7', expiryDate: '2027-03-31' };
const count = (html: string, needle: string) => html.split(needle).length - 1;

describe('labels', () => {
  it('fits every sheet inside A4', () => {
    for (const id of LABEL_LAYOUT_IDS) {
      const layout = LABEL_LAYOUTS[id];
      if (layout.kind !== 'SHEET') continue;
      expect(layout.marginLeftMm + layout.columns * layout.labelWidthMm + (layout.columns - 1) * layout.gapXMm, id).toBeLessThanOrEqual(210.01);
      expect(layout.marginTopMm + layout.rows * layout.labelHeightMm + (layout.rows - 1) * layout.gapYMm, id).toBeLessThanOrEqual(297.01);
    }
  });

  it('prints one label a page on a roll, sized to the label', () => {
    const html = labelsHtml([rice, rice, { ...rice, name: 'Tea' }], 'ROLL_50X25');
    expect(html).toContain('@page { size: 50mm 25mm; margin: 0; }');
    expect(count(html, 'class="page roll"')).toBe(3);
    expect(html).toContain('Basmati Rice &lt;Premium&gt; 1 kg');
    expect(html).toContain('₹120.00');
    expect(html).toContain('MRP ₹150.00');
    expect(html).toContain('Batch B7 · Exp 2027-03-31');
  });

  it('fills A4 sheets in a grid, from a chosen position on a used sheet', () => {
    const labels = Array.from({ length: 70 }, () => rice);
    const html = labelsHtml(labels, 'A4_65', { startAt: 4 });
    expect(html).toContain('@page { size: A4; margin: 0; }');
    // 3 skipped + 70 = 73 positions: a full sheet of 65, then 8.
    expect(count(html, 'class="page sheet"')).toBe(2);
    expect(count(html, 'class="label"')).toBe(70);
    expect(count(html, 'class="slot"')).toBe(73);
    // The 4th position is the 4th column of the first row.
    expect(html).toContain('left:126.50mm;top:10.70mm"><div class="label">');
  });

  it('leaves out what is switched off, and an MRP equal to the price', () => {
    const html = labelsHtml([{ ...rice, mrp: 120 }], 'A4_24', { showBatch: false, storeName: 'Everyday Mart' });
    expect(html).not.toContain('MRP');
    expect(html).not.toContain('Batch');
    expect(html).toContain('Everyday Mart');
    expect(labelsHtml([rice], 'A4_24', { showPrice: false, showMrp: false })).not.toContain('₹');
  });

  it('draws the Code 128 bars with quiet zones', () => {
    const svg = barcodeSvg('ABC-1');
    const modules = code128Modules('ABC-1');
    expect(svg).toContain(`viewBox="0 0 ${modules.length + 20} 1"`);
    const barWidth = [...svg.matchAll(/width="(\d+)"/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    expect(barWidth).toBe([...modules].filter((module) => module === '1').length);
    expect(svg).toMatch(/^<svg[^>]*><rect x="10" /);
  });

  it('refuses a barcode it cannot print', () => {
    expect(labelProblem({ name: 'Chai', barcode: 'चाय' })).toMatch(/can't be printed/);
    expect(() => labelsHtml([{ name: 'Chai', barcode: '' }], 'ROLL_38X25')).toThrow();
  });
});
