import { createHash, timingSafeEqual } from 'crypto';
import { createParamDecorator, type CanActivate, type ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { products } from '../config';

type ProductRequest = { headers: Record<string, string | string[] | undefined>; product?: string };

const digest = (value: string) => createHash('sha256').update(value).digest();

/** The product whose API key is the request's `Authorization: Bearer <key>`, or null. */
export function productForKey(header: string | string[] | undefined) {
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^Bearer\s+(\S+)$/i.exec(value?.trim() ?? '');
  if (!match) return null;
  // Compared as digests, in constant time, against every product's key.
  const given = digest(match[1]);
  let found: string | null = null;
  for (const product of products()) {
    if (timingSafeEqual(given, digest(product.apiKey))) found = product.name;
  }
  return found;
}

/** Only products, by their API key. The product is then the request's `@CallingProduct()`. */
@Injectable()
export class ProductAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ProductRequest>();
    const product = productForKey(request.headers.authorization);
    if (!product) throw new UnauthorizedException('A product API key is needed');
    request.product = product;
    return true;
  }
}

/** The product that made the request (after ProductAuthGuard). */
export const CallingProduct = createParamDecorator((_data: unknown, context: ExecutionContext) => {
  const product = context.switchToHttp().getRequest<ProductRequest>().product;
  if (!product) throw new UnauthorizedException('A product API key is needed');
  return product;
});
