/**
 * Code 128 barcodes, the kind every retail barcode scanner reads. Each symbol is 3 bars and
 * 3 spaces 11 modules wide (the stop symbol: 4 bars, 13 modules).
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

export const CODE128_PATTERNS: readonly string[] = PATTERNS;

/** True when Code 128 can carry the text: printable ASCII only. */
export function canEncodeCode128(text: string) {
  return text.length > 0 && text.length <= 40 && /^[\x20-\x7e]+$/.test(text);
}

/** The symbol values: start, data, checksum, stop. All digits (an even count) use the denser set C. */
export function code128Values(text: string): number[] {
  if (!canEncodeCode128(text)) throw new Error('Code 128 carries printable ASCII only');
  const digitsOnly = /^\d+$/.test(text) && text.length % 2 === 0;
  const start = digitsOnly ? START_C : START_B;
  const data = digitsOnly
    ? Array.from({ length: text.length / 2 }, (_, index) => Number(text.slice(index * 2, index * 2 + 2)))
    : Array.from(text, (char) => char.charCodeAt(0) - 32);
  const checksum = data.reduce((sum, value, index) => sum + value * (index + 1), start) % 103;
  return [start, ...data, checksum, STOP];
}

/**
 * The barcode as modules, '1' for bar and '0' for space, without the quiet zones (leave 10
 * blank modules each side when printing).
 */
export function code128Modules(text: string) {
  return code128Values(text)
    .map((value) =>
      Array.from(PATTERNS[value], (width, index) => (index % 2 === 0 ? '1' : '0').repeat(Number(width))).join('')
    )
    .join('');
}
