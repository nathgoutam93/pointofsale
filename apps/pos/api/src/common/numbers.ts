import { Prisma } from '@prisma/client';

export function toNumber(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

/** The app's one rounding (see roundTo in @pos/contracts): money to the paisa, quantities to three places. */
export { round2, round3 } from '@pos/contracts';
