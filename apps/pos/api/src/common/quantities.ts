import { BadRequestException } from '@nestjs/common';
import { round3 } from './numbers';

export function normalizeLeastCount(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    throw new BadRequestException('Least count must be greater than zero');
  }
  const normalized = round3(value);
  if (normalized < 0.001) {
    throw new BadRequestException('Least count cannot be less than 0.001');
  }
  return normalized;
}

export function assertQtyRespectsLeastCount(qty: number, leastCount: number, context: string) {
  const normalizedQty = round3(qty);
  if (!Number.isFinite(normalizedQty) || normalizedQty <= 0) {
    throw new BadRequestException(`${context} qty must be greater than zero`);
  }
  const normalizedLeastCount = normalizeLeastCount(leastCount);
  const quotient = normalizedQty / normalizedLeastCount;
  const nearestInteger = Math.round(quotient);
  if (Math.abs(quotient - nearestInteger) > 1e-6) {
    throw new BadRequestException(
      `${context} qty must be in multiples of ${normalizedLeastCount}`,
    );
  }
}
