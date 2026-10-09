/** The pages payers' browsers open: nothing from elsewhere, no scripts, forms post back here. */
export const PAGE_CSP = "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'";

export function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** Paise as rupees, e.g. 117882 → "₹1,178.82". */
export function rupees(paise: number) {
  return `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** A small page; `body` is HTML the caller has already escaped. */
export function simplePage(title: string, body: string) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 3rem auto; padding: 0 1rem; color: #1f2937; }
  h1 { font-size: 1.4rem; }
  button { font: inherit; padding: 0.6rem 1.2rem; margin: 0.25rem 0.5rem 0.25rem 0; cursor: pointer; }
  a { color: #1d4ed8; }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body}
</body>
</html>`;
}
