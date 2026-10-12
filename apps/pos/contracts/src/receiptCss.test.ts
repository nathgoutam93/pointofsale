import { describe, expect, it } from 'vitest';
import { sanitizeReceiptCss } from './receiptCss.js';

// #4: branch receipt CSS keeps only receipt-scoped, allowlisted rules.
describe('sanitizeReceiptCss', () => {
  it('scopes rules to the receipt and maps body/html/:root onto it', () => {
    const { css, problems } = sanitizeReceiptCss('body { font-size: 11px } .receipt-line { color: #333 !important } @media print { .receipt-logo { max-height: 40px } }');
    expect(problems).toEqual([]);
    expect(css).toBe(
      '#printable-invoice { font-size: 11px; }\n#printable-invoice .receipt-line { color: #333 !important; }\n@media print { #printable-invoice .receipt-logo { max-height: 40px; } }'
    );
  });

  it.each([
    ['a </style> breakout', '</style><script>alert(1)</script>'],
    ['@import', '@import url(https://evil.example/x.css);'],
    ['url() in a value', '.a { background-color: url(https://evil/?x) }'],
    ['attribute selectors', 'input[value^="a"] { color: red }'],
    ['sibling combinators', '#printable-invoice ~ div { display: none }'],
    ['disallowed properties', '.a { position: fixed; z-index: 9999 }'],
    ['CSS escapes', '.a { color: \\75 rl(x) }'],
    ['expression()', '.a { width: expression(alert(1)) }'],
    ['@font-face', '@font-face { font-family: x; src: url(x) }']
  ])('drops %s and reports it', (_name, input) => {
    const { css, problems } = sanitizeReceiptCss(input);
    expect(problems.length).toBeGreaterThan(0);
    expect(css).not.toMatch(/<|url\(|expression|@import|\[|position|~/);
  });

  it('keeps receipt width settings', () => {
    expect(sanitizeReceiptCss('#printable-invoice { --receipt-ch: 32; }')).toEqual({ css: '#printable-invoice { --receipt-ch: 32; }', problems: [] });
  });
});
