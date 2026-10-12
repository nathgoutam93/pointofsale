import type { NestExpressApplication } from '@nestjs/platform-express';
import { raw } from 'express';

/** What main.ts and the tests both set up on the app. */
export function configureApp(app: NestExpressApplication) {
  // A provider signs the exact bytes it sends, so its webhooks are kept unparsed.
  const webhookBody = raw({ type: () => true, limit: '1mb' });
  app.use('/webhooks', function providerWebhookBody(req: never, res: never, next: never) {
    webhookBody(req, res, next);
  });
  // Products call this service from their servers, and payers' browsers only navigate to it:
  // no CORS, so no other site's page can call it.
  app.disable('x-powered-by');
}
