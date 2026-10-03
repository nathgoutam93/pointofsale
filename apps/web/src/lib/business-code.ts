/** The business code last used on this device (online sign-in), so staff don't retype it. */
const KEY = 'pos_business_code';

export function rememberedBusinessCode() {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return '';
  }
}

export function rememberBusinessCode(code: string) {
  try {
    localStorage.setItem(KEY, code.trim().toUpperCase());
  } catch {
    // Not remembered; it's typed again next time.
  }
}
