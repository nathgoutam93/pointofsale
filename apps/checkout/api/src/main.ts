import './load-env';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app-config';
import { listenAddress, products, publicUrl, timerSeconds } from './config';
import { paymentProvider } from './providers/providers';

async function bootstrap() {
  // Fail now on a missing or malformed setting, not on the first payment.
  publicUrl();
  // Also refuses the dummy without CHECKOUT_ALLOW_TEST_PAYMENTS, and a real one without alerts.
  const provider = paymentProvider();
  timerSeconds();
  if (products().length === 0) throw new Error('CHECKOUT_PRODUCTS is empty: no product could take payments');
  const { port, host } = listenAddress();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  app.enableShutdownHooks();
  if (host) {
    await app.listen(port, host);
  } else {
    await app.listen(port);
  }
  process.stdout.write(`${JSON.stringify({ event: 'listening', service: 'checkout', port, provider: provider.name })}\n`);
}

bootstrap();
