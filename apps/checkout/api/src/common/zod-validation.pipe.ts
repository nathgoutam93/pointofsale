import { BadRequestException, type PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates a request body against a schema from @hackd/checkout-contracts and returns the parsed
 * value (unknown keys dropped, defaults applied), so handlers take their types from the contract.
 */
export class ZodValidationPipe<S extends z.ZodTypeAny> implements PipeTransform<unknown, z.output<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.output<S> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      );
    }
    return result.data;
  }
}
