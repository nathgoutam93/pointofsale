import { net, protocol } from 'electron';
import { existsSync, statSync } from 'fs';
import { join, normalize, sep } from 'path';
import { pathToFileURL } from 'url';
import { paths } from './paths.js';

export const APP_SCHEME = 'app';
export const APP_HOST = 'pos';
/** Where the web app is served from; also the Origin the local API allows. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;
/**
 * Where the page reaches the API: this app forwards app://pos/api/… to the local API or the
 * online server. The sign-in cookie lives in the app's cookie store, out of the page's reach,
 * and the page never needs the API's real (changing) address.
 */
export const PAGE_API_BASE = `${APP_ORIGIN}/api`;

/** Must run before the app is ready. `standard` gives the scheme normal URLs and a real origin. */
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ]);
}

/** The pages may only talk to the app itself (the API through app://pos/api). */
function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'"
  ].join('; ');
}

/** Request headers the page must not choose: the API sees this app, not a cross-site page. */
const DROPPED_REQUEST_HEADERS = ['host', 'origin', 'referer', 'cookie', 'connection'];

/**
 * app://pos/api/… → the API. Electron's network stack keeps the API's cookies (the sign-in)
 * in this app's cookie store and sends them back; the page only ever sees the answers.
 */
async function forwardToApi(request: Request, url: URL, apiBase: string | null) {
  if (!apiBase) {
    return Response.json({ statusCode: 503, message: 'The service is starting. Try again in a moment.' }, { status: 503 });
  }
  const headers = new Headers(request.headers);
  for (const name of DROPPED_REQUEST_HEADERS) headers.delete(name);
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  let response: Response;
  try {
    response = await net.fetch(`${apiBase}${url.pathname.slice('/api'.length)}${url.search}`, {
      method: request.method,
      headers,
      body: hasBody ? request.body : undefined,
      redirect: 'manual',
      ...(hasBody ? { duplex: 'half' } : {})
    } as RequestInit);
  } catch {
    return Response.json({ statusCode: 502, message: "Couldn't reach the server. Check the internet connection." }, { status: 502 });
  }
  const answer = new Headers(response.headers);
  answer.delete('set-cookie');
  const empty = response.status === 204 || response.status === 304 || request.method === 'HEAD';
  return new Response(empty ? null : response.body, { status: response.status, statusText: response.statusText, headers: answer });
}

/**
 * Serves apps/web/dist at app://pos/. Unknown paths get index.html, so the web app's own
 * router handles them (it uses browser-style paths, which file:// can't serve). /api/… goes
 * to the API this window works with.
 */
export function serveWebApp(currentApiBase: () => string | null) {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return forwardToApi(request, url, currentApiBase());

    const root = paths.web();
    const requested = normalize(join(root, decodeURIComponent(url.pathname)));
    const insideRoot = requested.startsWith(root + sep);
    const file = insideRoot && existsSync(requested) && statSync(requested).isFile() ? requested : join(root, 'index.html');

    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', contentSecurityPolicy());
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
}
