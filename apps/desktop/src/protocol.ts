import { net, protocol } from 'electron';
import { existsSync, statSync } from 'fs';
import { join, normalize, sep } from 'path';
import { pathToFileURL } from 'url';
import { paths } from './paths.js';

export const APP_SCHEME = 'app';
export const APP_HOST = 'pos';
/** Where the web app is served from; also the Origin the local API allows. */
export const APP_ORIGIN = `${APP_SCHEME}://${APP_HOST}`;

/** Must run before the app is ready. `standard` gives the scheme normal URLs and a real origin. */
export function registerAppScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }
  ]);
}

/** The pages may only talk to the app itself and to the API it is using. */
function contentSecurityPolicy(apiOrigin: string | null) {
  const api = apiOrigin ? ` ${apiOrigin}` : '';
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${api}`,
    `connect-src 'self'${api}`,
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-ancestors 'none'",
    "form-action 'none'"
  ].join('; ');
}

/**
 * Serves apps/web/dist at app://pos/. Unknown paths get index.html, so the web app's own
 * router handles them (it uses browser-style paths, which file:// can't serve).
 */
export function serveWebApp(currentApiOrigin: () => string | null) {
  protocol.handle(APP_SCHEME, async (request) => {
    const url = new URL(request.url);
    if (url.host !== APP_HOST) return new Response('Not found', { status: 404 });

    const root = paths.web();
    const requested = normalize(join(root, decodeURIComponent(url.pathname)));
    const insideRoot = requested.startsWith(root + sep);
    const file = insideRoot && existsSync(requested) && statSync(requested).isFile() ? requested : join(root, 'index.html');

    const response = await net.fetch(pathToFileURL(file).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', contentSecurityPolicy(currentApiOrigin()));
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
}
