import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { SESSION_COOKIE, SESSION_HEADER } from '@pos/contracts';
import { map } from 'rxjs';
import { tokenTtlSeconds, verifyToken } from './token';

type Headers = Record<string, string | string[] | undefined>;
type CookieRequest = { headers: Headers; secure?: boolean };
type CookieResponse = { append(name: string, value: string): void };

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);

/** The request asks for cookie sessions (the web app always does). */
export function wantsCookieSession(headers: Headers) {
  return first(headers[SESSION_HEADER]) === 'cookie';
}

/** The session cookie's value, only for requests that ask for cookie sessions (see SESSION_HEADER). */
export function sessionCookieToken(headers: Headers) {
  if (!wantsCookieSession(headers)) return null;
  for (const part of (first(headers.cookie) ?? '').split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === SESSION_COOKIE) {
      const value = part.slice(at + 1).trim();
      return value ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

/**
 * Secure when the request came over HTTPS (directly, or as the proxy in front says), unless
 * SESSION_COOKIE_SECURE says otherwise. SameSite is Lax unless SESSION_COOKIE_SAMESITE says
 * strict or none (none, for a web app on another site, always needs Secure).
 */
function cookieAttributes(req: CookieRequest, maxAge: number) {
  const sameSite = (process.env.SESSION_COOKIE_SAMESITE ?? '').trim().toLowerCase();
  const setting = (process.env.SESSION_COOKIE_SECURE ?? '').trim().toLowerCase();
  const https = req.secure === true || first(req.headers['x-forwarded-proto'])?.split(',')[0]?.trim() === 'https';
  const secure = setting === 'true' ? true : setting === 'false' ? false : https;
  const site = sameSite === 'strict' ? 'Strict' : sameSite === 'none' ? 'None' : 'Lax';
  return ['Path=/', 'HttpOnly', `SameSite=${site}`, `Max-Age=${maxAge}`, ...(secure || site === 'None' ? ['Secure'] : [])].join('; ');
}

export function setSessionCookie(req: CookieRequest, res: CookieResponse, token: string) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(req, tokenTtlSeconds())}`);
}

export function clearSessionCookie(req: CookieRequest, res: CookieResponse) {
  res.append('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(req, 0)}`);
}

/**
 * For cookie-session requests: a staff sign-in token in an answer (sign-in, setup, opening or
 * closing a register, a new password, a new business's admin) goes into the cookie and is
 * blanked in the body, so page scripts never see it. Owner tokens are left alone.
 */
@Injectable()
export class SessionCookieInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const http = context.switchToHttp();
    const req = http.getRequest<CookieRequest>();
    if (!wantsCookieSession(req.headers)) return next.handle();
    const res = http.getResponse<CookieResponse>();
    const moveToCookie = (holder: unknown) => {
      if (!holder || typeof holder !== 'object') return;
      const value = (holder as { token?: unknown }).token;
      if (typeof value === 'string' && verifyToken(value)) {
        setSessionCookie(req, res, value);
        (holder as { token: string }).token = '';
      }
    };
    return next.handle().pipe(
      map((body: unknown) => {
        moveToCookie(body);
        if (body && typeof body === 'object') moveToCookie((body as { session?: unknown }).session);
        return body;
      })
    );
  }
}
