/**
 * Branch receipt/invoice CSS is written by admins and injected into the POS, Sales and
 * Returns pages and into the downloadable invoice file. Only a safe subset is kept:
 * plain rules and @media blocks, every selector scoped to the receipt element, and an
 * allowlist of layout and typography properties with no url(), escapes or markup.
 * The server rejects CSS that loses anything here; the web app renders only the output.
 */

/** The receipt element; every custom rule is scoped inside it. */
export const RECEIPT_CSS_SCOPE = '#printable-invoice';
export const RECEIPT_CSS_MAX_LENGTH = 10000;

const ALLOWED_PROPERTIES = new Set([
  'color', 'background-color', 'opacity',
  'font', 'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'line-height', 'letter-spacing', 'word-spacing', 'text-align', 'text-transform',
  'text-decoration', 'text-indent', 'text-overflow', 'white-space', 'word-break',
  'overflow-wrap', 'vertical-align',
  'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'border', 'border-top', 'border-right', 'border-bottom', 'border-left',
  'border-width', 'border-style', 'border-color', 'border-radius',
  'border-collapse', 'border-spacing',
  'width', 'min-width', 'max-width', 'height', 'min-height', 'max-height',
  'display', 'gap', 'row-gap', 'column-gap', 'flex', 'flex-direction', 'flex-wrap',
  'justify-content', 'align-items', 'object-fit', 'list-style',
  'break-before', 'break-after', 'break-inside',
  'page-break-before', 'page-break-after', 'page-break-inside'
]);
const CUSTOM_PROPERTY = /^--receipt-[a-z0-9-]+$/;
// No ':', ';', braces, '<', '\' or '@', so a value can't end the rule, the <style> tag, or hide an escape.
const SAFE_VALUE = /^[a-z0-9\s#%.,()'"\-+*/!_]+$/i;
const BLOCKED_FUNCTION = /\b(url|expression|image|image-set|cross-fade|element|attr)\s*\(/i;
// No attribute selectors (they can match typed input values) and no sibling combinators
// (they reach elements next to the receipt).
const SAFE_SELECTOR = /^[a-z0-9\s.#\-_>:*()]+$/i;
const SAFE_MEDIA_QUERY = /^[a-z0-9\s(),:.-]+$/i;
const PAGE_ROOT = /^(html|body|:root)$/i;
const STARTS_WITH_SCOPE = new RegExp(`^${RECEIPT_CSS_SCOPE}(?=$|[.:])`);

export type ReceiptCssResult = {
  /** The rebuilt CSS, containing only what passed the checks. */
  css: string;
  /** What was dropped, for showing to the admin. Empty when the input is fully allowed. */
  problems: string[];
};

type Block = { prelude: string; body: string };

const shorten = (text: string) => {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
};

/** Splits CSS into top-level `prelude { body }` blocks, honouring nesting and quotes. */
function splitBlocks(css: string, problems: string[]): Block[] {
  const blocks: Block[] = [];
  let depth = 0;
  let quote: string | null = null;
  let prelude = '';
  let body = '';
  for (const char of css) {
    if (quote) {
      if (char === quote) quote = null;
      if (depth > 0) body += char;
      else prelude += char;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '{') {
      depth += 1;
      if (depth === 1) continue;
    } else if (char === '}') {
      if (depth === 0) {
        problems.push('Unexpected "}"');
        continue;
      }
      depth -= 1;
      if (depth === 0) {
        blocks.push({ prelude: prelude.trim(), body });
        prelude = '';
        body = '';
        continue;
      }
    } else if (char === ';' && depth === 0) {
      // A statement such as `@import url(...);` or stray text.
      const statement = prelude.trim();
      if (statement) {
        problems.push(statement.startsWith('@') ? `"${statement.split(/\s/)[0]}" is not allowed` : `Unexpected text "${shorten(statement)}"`);
      }
      prelude = '';
      continue;
    }
    if (depth > 0) body += char;
    else prelude += char;
  }
  if (depth > 0 || quote) {
    problems.push('A rule is missing its closing "}" or quote');
  } else if (prelude.trim()) {
    problems.push(`Unexpected text "${shorten(prelude)}"`);
  }
  return blocks;
}

/** Splits on `;` outside quotes and parentheses. */
function splitDeclarations(body: string) {
  const parts: string[] = [];
  let current = '';
  let quote: string | null = null;
  let parens = 0;
  for (const char of body) {
    if (quote) {
      if (char === quote) quote = null;
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === '(') {
      parens += 1;
    } else if (char === ')') {
      parens = Math.max(0, parens - 1);
    } else if (char === ';' && parens === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

function scopeSelector(selector: string, problems: string[]) {
  const normalized = selector.replace(/\s*>\s*/g, ' > ').replace(/\s+/g, ' ').trim();
  if (!normalized || !SAFE_SELECTOR.test(normalized)) {
    problems.push(`Selector "${shorten(selector)}" is not allowed`);
    return null;
  }
  const parts = normalized.split(' ');
  // A leading html/body/:root means the page; point it at the receipt instead.
  while (parts.length && (PAGE_ROOT.test(parts[0]) || parts[0] === '>')) {
    parts.shift();
  }
  if (parts.length === 0) return RECEIPT_CSS_SCOPE;
  const rest = parts.join(' ');
  return STARTS_WITH_SCOPE.test(rest) ? rest : `${RECEIPT_CSS_SCOPE} ${rest}`;
}

function buildRule(prelude: string, body: string, problems: string[]) {
  const selectors = prelude
    .split(',')
    .map((selector) => scopeSelector(selector, problems))
    .filter((selector): selector is string => selector !== null);
  const declarations: string[] = [];
  for (const declaration of splitDeclarations(body)) {
    const colon = declaration.indexOf(':');
    if (colon <= 0) {
      problems.push(`Declaration "${shorten(declaration)}" is not valid`);
      continue;
    }
    const property = declaration.slice(0, colon).trim().toLowerCase();
    let value = declaration.slice(colon + 1).trim();
    const important = /!\s*important$/i.test(value);
    if (important) value = value.replace(/!\s*important$/i, '').trim();
    if (!ALLOWED_PROPERTIES.has(property) && !CUSTOM_PROPERTY.test(property)) {
      problems.push(`Property "${shorten(property)}" is not allowed`);
      continue;
    }
    if (!value || !SAFE_VALUE.test(value) || BLOCKED_FUNCTION.test(value) || value.includes('!')) {
      problems.push(`Value "${shorten(value)}" for "${property}" is not allowed`);
      continue;
    }
    declarations.push(`${property}: ${value}${important ? ' !important' : ''};`);
  }
  if (selectors.length === 0 || declarations.length === 0) return null;
  return `${selectors.join(', ')} { ${declarations.join(' ')} }`;
}

export function sanitizeReceiptCss(input: string | null | undefined): ReceiptCssResult {
  const problems: string[] = [];
  if (!input || !input.trim()) return { css: '', problems };
  let css = input;
  if (css.length > RECEIPT_CSS_MAX_LENGTH) {
    problems.push(`CSS is longer than ${RECEIPT_CSS_MAX_LENGTH} characters`);
    css = css.slice(0, RECEIPT_CSS_MAX_LENGTH);
  }
  css = css.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ');

  const output: string[] = [];
  for (const block of splitBlocks(css, problems)) {
    if (block.prelude.startsWith('@')) {
      const media = /^@media\s+([\s\S]+)$/i.exec(block.prelude);
      if (!media) {
        problems.push(`"${block.prelude.split(/\s/)[0]}" is not allowed`);
        continue;
      }
      if (!SAFE_MEDIA_QUERY.test(media[1])) {
        problems.push(`Media query "${shorten(media[1])}" is not allowed`);
        continue;
      }
      const rules = splitBlocks(block.body, problems)
        .map((inner) => {
          if (inner.prelude.startsWith('@')) {
            problems.push(`"${inner.prelude.split(/\s/)[0]}" is not allowed inside @media`);
            return null;
          }
          return buildRule(inner.prelude, inner.body, problems);
        })
        .filter((rule): rule is string => rule !== null);
      if (rules.length) output.push(`@media ${media[1].replace(/\s+/g, ' ').trim()} { ${rules.join(' ')} }`);
      continue;
    }
    const rule = buildRule(block.prelude, block.body, problems);
    if (rule) output.push(rule);
  }
  return { css: output.join('\n'), problems: Array.from(new Set(problems)) };
}
