import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, map, mergeMap } from 'rxjs';
import { readBearerToken, verifyToken } from '../auth/token';
import { AccessService } from './access.service';
import type { RequestHeaders } from './request-session';

/** Fields that say what goods cost: an item's cost price, a line's cost. */
const COST_FIELDS = new Set(['costPrice', 'unitCost']);

/** `value` with every cost field emptied (null), however deep; other values untouched. */
export function withoutCosts(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutCosts);
  if (value === null || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) return value;
  return Object.fromEntries(Object.entries(value).map(([key, inner]) => [key, COST_FIELDS.has(key) ? null : withoutCosts(inner)]));
}

/**
 * What goods cost is for admins and those who adjust stock or record purchases: for any other
 * signed-in user, every answer has its cost prices and line costs emptied, whichever endpoint
 * it comes from (items, stock movements, transfers, sales lines...). Requests without a session
 * (a fallback counter syncing with its key) are left as they are.
 */
@Injectable()
export class CostVisibilityInterceptor implements NestInterceptor {
  constructor(private readonly access: AccessService) {}

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();
    const headers = context.switchToHttp().getRequest<{ headers: RequestHeaders }>().headers;
    const token = readBearerToken(headers);
    const session = token ? verifyToken(token) : null;
    if (!session) return next.handle();
    return next.handle().pipe(
      mergeMap((body) => from(this.access.maySeeCosts(session)).pipe(map((allowed) => (allowed ? body : withoutCosts(body)))))
    );
  }
}
