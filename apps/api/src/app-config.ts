import { ForbiddenException } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { json, raw } from 'express';
import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { CLIENT_VERSION_HEADER, FALLBACK_UNAVAILABLE, isOlderVersion, UPDATE_REQUIRED_STATUS } from '@pos/contracts';
import { isFallback, minClientVersion, posMode } from './common/mode';
import { isFallbackWrite } from './fallback/outbox';
import { uploadsDir } from './common/uploads';
import { tenantStorage } from './tenancy/tenant-context';

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

/** The web app's dev server, allowed by default in offline mode so `pnpm dev` keeps working. */
const OFFLINE_DEV_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000'];

/**
 * Where the API listens. PORT=0 picks a free port (the desktop app reads it from the
 * "listening" line). Offline installs listen on this machine only: first-run setup is
 * open to anyone who can reach the API until the admin is created.
 */
export function listenAddress() {
  const port = process.env.PORT ? Number(process.env.PORT) : 3001;
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT must be a port number, not "${process.env.PORT}"`);
  }
  const host = process.env.HOST?.trim() || undefined;
  if (posMode() === 'offline') {
    if (host && !LOOPBACK_HOSTS.has(host)) {
      throw new Error(`HOST must be 127.0.0.1, ::1 or localhost in offline mode, not "${host}"`);
    }
    return { port, host: host ?? '127.0.0.1' };
  }
  return { port, host };
}

/**
 * CORS_ORIGINS (comma-separated) limits which web origins may call the API. Only those listed
 * may send the session cookie (credentials): with no list online, any origin may call the API
 * with a bearer token, but no other site's page can use a signed-in browser's cookie.
 */
function corsOptions(): CorsOptions {
  const configured = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  if (configured.length) return { origin: configured, credentials: true };
  // Offline: only the dev server, so a web page open in the user's browser can't drive the
  // local API.
  return posMode() === 'offline' ? { origin: OFFLINE_DEV_ORIGINS, credentials: true } : {};
}

/** The request's Host header without its port. */
function hostName(host: string | undefined) {
  if (!host) return '';
  if (host.startsWith('[')) return host.slice(0, host.indexOf(']') + 1);
  return host.split(':')[0];
}

/** CORS, the offline Host check and the /uploads/ static files, shared by main.ts and the tests. */
export function configureApp(app: NestExpressApplication) {
  app.enableCors(corsOptions());

  // A fallback counter's offline sales come in one request, larger than other requests may be.
  // Wrapped under another name: Nest skips its own JSON parser if one named jsonParser is in use.
  const syncBody = json({ limit: '25mb' });
  app.use('/fallback/sync', function fallbackSyncBody(req: never, res: never, next: never) {
    syncBody(req, res, next);
  });

  // A payment gateway signs the exact bytes it sends, so its webhooks are kept unparsed.
  const webhookBody = raw({ type: () => true, limit: '1mb' });
  app.use('/billing/webhooks', function billingWebhookBody(req: never, res: never, next: never) {
    webhookBody(req, res, next);
  });

  // Every request gets its own business context; sign-in or the token check fills it in.
  app.use((_req: unknown, _res: unknown, next: () => void) => tenantStorage.run({}, next));

  if (posMode() === 'offline') {
    // A web page can point its own domain at 127.0.0.1 (DNS rebinding) and then call the
    // local API as same-origin, bypassing CORS. Such requests carry that domain as Host.
    app.use((req: { headers: { host?: string } }, _res: unknown, next: (error?: unknown) => void) => {
      if (!LOOPBACK_HOSTS.has(hostName(req.headers.host).toLowerCase())) {
        next(new ForbiddenException('This API only answers requests made to 127.0.0.1 or localhost'));
        return;
      }
      next();
    });
  }

  // A fallback counter working offline: reading, signing in, the register, selling (credit too),
  // adding customers, and payments and returns of the bills it has. The rest needs the server.
  if (isFallback()) {
    app.use(
      (
        req: { method: string; path: string },
        res: { status(code: number): { json(body: unknown): void } },
        next: () => void
      ) => {
        if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS' || isFallbackWrite(req.method, req.path)) {
          next();
          return;
        }
        res.status(403).json({
          statusCode: 403,
          code: FALLBACK_UNAVAILABLE,
          message: "Not while working offline. It's back once the server is and the offline sales are sent."
        });
      }
    );
  }

  // Online: an app older than MIN_CLIENT_VERSION may not match this API, so it is turned
  // away and updates itself (the desktop app sends its version with every request).
  // /meta stays open so an old app can still learn what it needs.
  app.use(
    (
      req: { headers: Record<string, string | string[] | undefined>; path: string },
      res: { status(code: number): { json(body: unknown): void } },
      next: () => void
    ) => {
      const minimum = minClientVersion();
      const version = req.headers[CLIENT_VERSION_HEADER];
      if (minimum && typeof version === 'string' && req.path !== '/meta' && isOlderVersion(version, minimum)) {
        res.status(UPDATE_REQUIRED_STATUS).json({
          statusCode: UPDATE_REQUIRED_STATUS,
          message: `This app (version ${version}) is too old for this server. Update to version ${minimum} or later.`,
          minClientVersion: minimum
        });
        return;
      }
      next();
    }
  );

  for (const dir of [uploadsDir, join(uploadsDir, 'items'), join(uploadsDir, 'branches'), join(uploadsDir, 'business')]) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });
}
