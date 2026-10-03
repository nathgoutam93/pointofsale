import './load-env';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp, listenAddress } from './app-config';
import { assertAuthConfigured } from './auth/token';
import { minClientVersion, posHosting, posMode } from './common/mode';

async function bootstrap() {
  assertAuthConfigured();
  const mode = posMode();
  // Fail now on a malformed value, not on the first request.
  minClientVersion();
  posHosting();
  const { port, host } = listenAddress();

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  configureApp(app);
  if (host) {
    await app.listen(port, host);
  } else {
    await app.listen(port);
  }

  // One JSON line the desktop app waits for, to learn the port when PORT=0.
  const address = app.getHttpServer().address();
  const actualPort = typeof address === 'object' && address ? address.port : port;
  process.stdout.write(`${JSON.stringify({ event: 'listening', mode, port: actualPort })}\n`);
}

bootstrap();
