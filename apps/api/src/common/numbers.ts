import { Prisma } from '@prisma/client';

export function toNumber(value: Prisma.Decimal | number | null | undefined) {
  return Number(value ?? 0);
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}

export function round3(value: number) {
  return Math.round(value * 1000) / 1000;
}
