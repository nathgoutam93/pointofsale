import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors();

  const uploadsDir = join(process.cwd(), 'uploads');
  if (!existsSync(uploadsDir)) {
    mkdirSync(uploadsDir, { recursive: true });
  }
  const itemUploadsDir = join(uploadsDir, 'items');
  if (!existsSync(itemUploadsDir)) {
    mkdirSync(itemUploadsDir, { recursive: true });
  }
  const branchUploadsDir = join(uploadsDir, 'branches');
  if (!existsSync(branchUploadsDir)) {
    mkdirSync(branchUploadsDir, { recursive: true });
  }
  app.useStaticAssets(uploadsDir, { prefix: '/uploads/' });

  await app.listen(process.env.PORT ? Number(process.env.PORT) : 3001);
}

bootstrap();
