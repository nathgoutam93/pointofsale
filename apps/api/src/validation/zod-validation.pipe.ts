import { BadRequestException, PipeTransform } from '@nestjs/common';

type SafeParseResult =
  | { success: true; data: unknown }
  | { success: false; error: { issues: Array<{ path: Array<string | number>; message: string }> } };

/** The part of a zod schema this pipe uses, so the API doesn't need its own zod dependency. */
type Schema = { safeParse(input: unknown): SafeParseResult };

/**
 * Validates a request body against a schema from `@pos/contracts`.
 * Returns the parsed value, so unknown keys are dropped and defaults are applied.
 */
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: Schema) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((issue) =>
        issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message
      );
      throw new BadRequestException(details);
    }
    return result.data;
  }
}
