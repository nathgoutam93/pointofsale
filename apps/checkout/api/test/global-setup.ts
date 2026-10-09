import { execSync } from 'child_process';
import { PrismaClient } from '.prisma/checkout-client';

/** A clean test database before the run: dropped, recreated and migrated. */
export default async function setup() {
  const url = new URL(process.env.CHECKOUT_TEST_DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/checkout_test?schema=public');
  const database = url.pathname.slice(1);
  if (!/_test\b|test_/.test(database)) {
    throw new Error(`Refusing to reset ${database}: the test database name must contain "test".`);
  }
  const server = new URL(url);
  server.pathname = '/postgres';
  const admin = new PrismaClient({ datasourceUrl: server.toString() });
  try {
    await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${database}" WITH (FORCE)`);
    await admin.$executeRawUnsafe(`CREATE DATABASE "${database}"`);
  } finally {
    await admin.$disconnect();
  }
  const cwd = new URL('..', import.meta.url).pathname;
  execSync('npx prisma migrate deploy', { cwd, env: { ...process.env, DATABASE_URL: url.toString() }, stdio: 'pipe' });
}
