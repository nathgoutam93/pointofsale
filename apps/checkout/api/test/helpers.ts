import { createServer, type IncomingHttpHeaders } from 'http';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app-config';
import { PrismaService } from '../src/common/prisma.service';
import { NotificationsService } from '../src/notifications/notifications.service';

export const POS_KEY = process.env.CHECKOUT_POS_API_KEY!;
export const POS_SECRET = process.env.CHECKOUT_POS_NOTIFY_SECRET!;

/** The real app on a random port. */
export async function startApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  const address = app.getHttpServer().address();
  const baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;

  async function request(method: string, path: string, options: { body?: unknown; key?: string | null; form?: Record<string, string> } = {}) {
    const headers: Record<string, string> = {};
    if (options.key !== null) headers.authorization = `Bearer ${options.key ?? POS_KEY}`;
    let body: string | undefined;
    if (options.form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams(options.form).toString();
    } else if (options.body !== undefined) {
      headers['content-type'] = 'application/json';
      body = JSON.stringify(options.body);
    }
    const res = await fetch(`${baseUrl}${path}`, { method, headers, body, redirect: 'manual' });
    const text = await res.text();
    let json: any = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: res.status, body: json, text, location: res.headers.get('location'), headers: res.headers };
  }

  return {
    app,
    baseUrl,
    request,
    db: app.get(PrismaService),
    notifications: app.get(NotificationsService),
    close: () => app.close()
  };
}

export type ReceivedNotice = { headers: IncomingHttpHeaders; body: string };

/**
 * A product's notice endpoint: records what it's sent and answers with `status()` (200 unless
 * a test says otherwise). CHECKOUT_POS_NOTIFY_URL points at it.
 */
export async function startProduct() {
  const received: ReceivedNotice[] = [];
  let answer = 200;
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks).toString('utf8') });
      res.statusCode = answer;
      res.end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  process.env.CHECKOUT_POS_NOTIFY_URL = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/billing/webhooks/checkout`;
  return {
    received,
    answerWith(status: number) {
      answer = status;
    },
    /** The notices received about one session (others' can arrive at any time: they're sent after the webhook is answered). */
    forSession(sessionId: string) {
      return received.filter((notice) => JSON.parse(notice.body).sessionId === sessionId);
    },
    /** Waits (up to 5 s) until `count` notices about the session have arrived, and returns them. */
    async waitFor(sessionId: string, count = 1) {
      for (let i = 0; i < 250 && this.forSession(sessionId).length < count; i += 1) await new Promise((resolve) => setTimeout(resolve, 20));
      return this.forSession(sessionId);
    },
    close: () => new Promise<void>((resolve) => server.close(() => resolve()))
  };
}
